// ---------------------------------------------------------------------------
// Price negotiations — business logic
// ---------------------------------------------------------------------------

import type {
  NegotiationDetailResponse,
  NegotiationListResponse,
  NegotiationRound,
  NegotiationStatus,
  PriceNegotiation,
} from '@mohandishub/shared';
import type { PoolClient } from 'pg';

import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ServicesRepository } from '../services/services.repository.js';

import {
  INACTIVITY_HOURS,
  MAX_ROUNDS,
  NegotiationsRepository,
  type PriceNegotiationRow,
  type PriceNegotiationRoundRow,
} from './negotiations.repository.js';
import type { CreateNegotiationInput, RespondNegotiationInput } from './negotiations.validation.js';

function toNumber(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function mapNegotiation(row: PriceNegotiationRow): PriceNegotiation {
  const base: PriceNegotiation = {
    id: row.id,
    serviceId: row.service_id,
    customerId: row.customer_id,
    providerId: row.provider_id,
    status: row.status as NegotiationStatus,
    originalPrice: toNumber(row.original_price),
    agreedPrice: toNumber(row.agreed_price),
    latestAmount: toNumber(row.latest_amount) ?? 0,
    latestOfferedBy: row.latest_offered_by,
    currency: row.currency,
    expiresAt: row.expires_at.toISOString(),
    agreedValidUntil: row.agreed_valid_until?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (row.service_title != null) base.serviceTitle = row.service_title;
  if (row.customer_name != null) base.customerName = row.customer_name;
  if (row.provider_name != null) base.providerName = row.provider_name;
  return base;
}

function mapRound(r: PriceNegotiationRoundRow): NegotiationRound {
  return {
    id: r.id,
    negotiationId: r.negotiation_id,
    offeredBy: r.offered_by,
    amount: toNumber(r.amount) ?? 0,
    message: r.message,
    createdAt: r.created_at.toISOString(),
  };
}

export class NegotiationsService {
  constructor(
    private readonly repo: NegotiationsRepository = new NegotiationsRepository(),
    private readonly servicesRepo: ServicesRepository = new ServicesRepository(),
    private readonly notifications: NotificationsService = new NotificationsService(),
  ) {}

  private priceCeiling(originalPrice: number | null): number {
    const base = originalPrice != null && originalPrice > 0 ? originalPrice : 1;
    return base * 10;
  }

  /** Apply inactivity / agreed-validity expiry; returns fresh row or null if gone. */
  private async refreshRowState(row: PriceNegotiationRow): Promise<PriceNegotiationRow | null> {
    const now = new Date();
    if (row.status === 'pending' && row.expires_at < now) {
      await this.repo.expirePendingNegotiation(row.id);
      return this.repo.findById(row.id);
    }
    if (row.status === 'accepted' && row.agreed_valid_until && row.agreed_valid_until < now) {
      await this.repo.expireAcceptedPastValidUntil(row.id);
      return this.repo.findById(row.id);
    }
    if (row.status === 'pending') {
      const svc = await this.servicesRepo.getActiveServiceById(row.service_id);
      if (!svc) {
        await this.repo.expirePendingForInactiveService(row.service_id);
        return this.repo.findById(row.id);
      }
    }
    return row;
  }

  async createNegotiation(
    customerId: string,
    input: CreateNegotiationInput,
  ): Promise<NegotiationDetailResponse> {
    const service = await this.servicesRepo.getActiveServiceById(input.serviceId);
    if (!service) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service is not available.',
      });
    }
    if (!service.is_negotiable) {
      throw new HttpError({
        statusCode: 400,
        code: 'NOT_NEGOTIABLE',
        message: 'This service does not allow price negotiation.',
      });
    }
    if (service.provider_id === customerId) {
      throw new HttpError({
        statusCode: 400,
        code: 'CANNOT_NEGOTIATE_OWN_SERVICE',
        message: 'You cannot negotiate your own service.',
      });
    }
    const existing = await this.repo.findPendingByCustomerAndService(customerId, input.serviceId);
    if (existing) {
      const refreshed = await this.refreshRowState(existing);
      if (refreshed && refreshed.status === 'pending') {
        throw new HttpError({
          statusCode: 409,
          code: 'NEGOTIATION_ALREADY_ACTIVE',
          message: 'You already have an active negotiation for this service.',
        });
      }
    }

    const originalPrice = service.price != null ? toNumber(service.price) : null;
    const ceiling = this.priceCeiling(originalPrice);
    if (input.offeredPrice > ceiling) {
      throw new HttpError({
        statusCode: 400,
        code: 'PRICE_TOO_HIGH',
        message: `Offered price cannot exceed ${ceiling} ${service.currency}.`,
      });
    }

    const row = await this.repo.createNegotiationWithFirstRound({
      serviceId: input.serviceId,
      customerId,
      providerId: service.provider_id,
      originalPrice,
      currency: service.currency || 'EGP',
      offeredPrice: input.offeredPrice,
      message: input.message?.trim() || null,
    });

    const full = await this.repo.findById(row.id);
    if (!full) {
      throw new HttpError({
        statusCode: 500,
        code: 'INTERNAL',
        message: 'Failed to load negotiation.',
      });
    }

    void this.notifications.createForUser(service.provider_id, {
      type: 'price_negotiation',
      title: 'New price negotiation',
      message: `A customer proposed ${input.offeredPrice} ${full.currency} for "${full.service_title ?? 'your service'}".`,
      payload: { negotiationId: full.id, serviceId: input.serviceId },
    });

    const rounds = await this.repo.listRounds(full.id);
    return { negotiation: mapNegotiation(full), rounds: rounds.map(mapRound) };
  }

  async getDetail(userId: string, negotiationId: string): Promise<NegotiationDetailResponse> {
    let row = await this.repo.findById(negotiationId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Negotiation not found.',
      });
    }
    if (row.customer_id !== userId && row.provider_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Access denied.' });
    }
    row = (await this.refreshRowState(row)) ?? row;
    const rounds = await this.repo.listRounds(negotiationId);
    return { negotiation: mapNegotiation(row), rounds: rounds.map(mapRound) };
  }

  async listNegotiations(
    userId: string,
    role: 'customer' | 'provider',
    status: string | undefined,
    serviceId: string | undefined,
    page: number,
    limit: number,
  ): Promise<NegotiationListResponse> {
    const { rows, total } = await this.repo.listForUser(
      userId,
      role,
      status,
      serviceId,
      page,
      limit,
    );
    const refreshed: PriceNegotiationRow[] = [];
    for (const r of rows) {
      const u = await this.refreshRowState(r);
      refreshed.push(u ?? r);
    }
    return {
      items: refreshed.map(mapNegotiation),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async respondToNegotiation(
    userId: string,
    negotiationId: string,
    input: RespondNegotiationInput,
  ): Promise<NegotiationDetailResponse> {
    let row = await this.repo.findById(negotiationId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Negotiation not found.',
      });
    }
    if (row.customer_id !== userId && row.provider_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Access denied.' });
    }
    row = (await this.refreshRowState(row)) ?? row;
    if (row.status !== 'pending') {
      throw new HttpError({
        statusCode: 409,
        code: 'NEGOTIATION_NOT_PENDING',
        message: 'This negotiation is no longer active.',
      });
    }

    const isCustomer = userId === row.customer_id;
    const isProvider = userId === row.provider_id;
    const latestBy = row.latest_offered_by;
    const responderMustNotBeLatest = userId !== latestBy;
    if (!responderMustNotBeLatest) {
      throw new HttpError({
        statusCode: 400,
        code: 'NOT_YOUR_TURN',
        message: 'Wait for the other party to respond.',
      });
    }

    const roundCount = await this.repo.countRounds(negotiationId);
    if (input.decision === 'counter' && roundCount >= MAX_ROUNDS) {
      throw new HttpError({
        statusCode: 400,
        code: 'MAX_ROUNDS',
        message: `Maximum of ${MAX_ROUNDS} offers reached. Accept or reject only.`,
      });
    }

    const originalPrice = toNumber(row.original_price);
    const ceiling = this.priceCeiling(originalPrice);

    if (input.decision === 'accept') {
      const agreed = toNumber(row.latest_amount);
      if (agreed == null) {
        throw new HttpError({
          statusCode: 400,
          code: 'INVALID_STATE',
          message: 'No amount to accept.',
        });
      }
      let validHours = 48;
      if (isProvider) {
        if (input.validForHours == null) {
          throw new HttpError({
            statusCode: 400,
            code: 'VALID_FOR_HOURS_REQUIRED',
            message: 'Choose how long the agreed price stays valid (24, 48, or 168 hours).',
          });
        }
        validHours = input.validForHours;
      }
      const until = new Date(Date.now() + validHours * 60 * 60 * 1000);
      const updated = await this.repo.updatePendingToAccepted(negotiationId, agreed, until);
      if (!updated) {
        throw new HttpError({
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Negotiation was already updated.',
        });
      }
      const otherId = isCustomer ? row.provider_id : row.customer_id;
      void this.notifications.createForUser(otherId, {
        type: 'price_negotiation',
        title: 'Price agreed',
        message: `Agreed price ${agreed} ${row.currency}. Book within ${validHours} hours.`,
        payload: { negotiationId, serviceId: row.service_id },
      });
      const full = await this.repo.findById(negotiationId);
      const rounds = await this.repo.listRounds(negotiationId);
      return { negotiation: mapNegotiation(full!), rounds: rounds.map(mapRound) };
    }

    if (input.decision === 'reject') {
      const updated = await this.repo.updatePendingToRejected(negotiationId);
      if (!updated) {
        throw new HttpError({
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Negotiation was already updated.',
        });
      }
      const otherId = isCustomer ? row.provider_id : row.customer_id;
      void this.notifications.createForUser(otherId, {
        type: 'price_negotiation',
        title: 'Negotiation declined',
        message: 'The other party declined the current offer.',
        payload: { negotiationId, serviceId: row.service_id },
      });
      const full = await this.repo.findById(negotiationId);
      const rounds = await this.repo.listRounds(negotiationId);
      return { negotiation: mapNegotiation(full!), rounds: rounds.map(mapRound) };
    }

    // counter
    const counter = input.counterPrice!;
    if (counter > ceiling) {
      throw new HttpError({
        statusCode: 400,
        code: 'PRICE_TOO_HIGH',
        message: `Counter price cannot exceed ${ceiling} ${row.currency}.`,
      });
    }
    const updated = await this.repo.updatePendingToCounter(negotiationId, userId, counter);
    if (!updated) {
      throw new HttpError({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Negotiation was already updated.',
      });
    }
    await this.repo.insertRound(negotiationId, userId, counter, input.message?.trim() ?? null);
    const otherId = isCustomer ? row.provider_id : row.customer_id;
    void this.notifications.createForUser(otherId, {
      type: 'price_negotiation',
      title: 'Counter-offer received',
      message: `New offer: ${counter} ${row.currency}.`,
      payload: { negotiationId, serviceId: row.service_id },
    });
    const full = await this.repo.findById(negotiationId);
    const rounds = await this.repo.listRounds(negotiationId);
    return { negotiation: mapNegotiation(full!), rounds: rounds.map(mapRound) };
  }

  async cancelNegotiation(
    customerId: string,
    negotiationId: string,
  ): Promise<NegotiationDetailResponse> {
    const row = await this.repo.findById(negotiationId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Negotiation not found.',
      });
    }
    if (row.customer_id !== customerId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only the customer can cancel.',
      });
    }
    const updated = await this.repo.cancelPending(negotiationId, customerId);
    if (!updated) {
      throw new HttpError({
        statusCode: 409,
        code: 'CANNOT_CANCEL',
        message: 'Negotiation cannot be cancelled.',
      });
    }
    void this.notifications.createForUser(row.provider_id, {
      type: 'price_negotiation',
      title: 'Negotiation cancelled',
      message: 'The customer cancelled the price negotiation.',
      payload: { negotiationId, serviceId: row.service_id },
    });
    const full = await this.repo.findById(negotiationId);
    const rounds = await this.repo.listRounds(negotiationId);
    return { negotiation: mapNegotiation(full!), rounds: rounds.map(mapRound) };
  }

  /** Validate accepted negotiation for booking (does not consume). */
  async validateNegotiationForReservation(
    customerId: string,
    negotiationId: string,
    serviceId: string,
    providerId: string,
  ): Promise<{ agreedPrice: number; currency: string }> {
    let row = await this.repo.findById(negotiationId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'NEGOTIATION_NOT_FOUND',
        message: 'Negotiation not found.',
      });
    }
    if (row.customer_id !== customerId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This negotiation is not yours.',
      });
    }
    if (row.service_id !== serviceId || row.provider_id !== providerId) {
      throw new HttpError({
        statusCode: 400,
        code: 'NEGOTIATION_MISMATCH',
        message: 'Negotiation does not match this booking.',
      });
    }
    row = (await this.refreshRowState(row)) ?? row;
    if (row.status !== 'accepted') {
      throw new HttpError({
        statusCode: 400,
        code: 'NEGOTIATION_NOT_ACCEPTED',
        message: 'Negotiation is not in an accepted state.',
      });
    }
    if (row.agreed_valid_until && row.agreed_valid_until < new Date()) {
      await this.repo.expireAcceptedPastValidUntil(negotiationId);
      throw new HttpError({
        statusCode: 400,
        code: 'NEGOTIATION_EXPIRED',
        message: 'The agreed price offer has expired. Negotiate again.',
      });
    }
    const agreed = toNumber(row.agreed_price);
    if (agreed == null) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_NEGOTIATION',
        message: 'No agreed price.',
      });
    }
    return { agreedPrice: agreed, currency: row.currency };
  }

  /** Mark negotiation consumed after reservation is created (same DB transaction as booking). */
  async markNegotiationConsumed(
    negotiationId: string,
    customerId: string,
    client: PoolClient,
  ): Promise<void> {
    const res = await client.query(
      `UPDATE price_negotiations SET status = 'consumed', updated_at = now()
       WHERE id = $1 AND customer_id = $2 AND status = 'accepted'`,
      [negotiationId, customerId],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new HttpError({
        statusCode: 409,
        code: 'NEGOTIATION_ALREADY_USED',
        message: 'Negotiation could not be marked consumed.',
      });
    }
  }

  async cancelPendingForCustomerService(customerId: string, serviceId: string): Promise<void> {
    await this.repo.cancelPendingByCustomerAndService(customerId, serviceId);
  }
}

export { INACTIVITY_HOURS, MAX_ROUNDS };
