import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { ActivationGateService } from '../mhc/activation-gate.service.js';

import {
  ProviderPaymentsRepository,
  type ProviderPaymentMethodRow,
} from './provider-payments.repository.js';
import type { UpsertPaymentMethodInput } from './provider-payments.validation.js';

/** Roles that can be paid directly by a customer. */
const PROVIDER_ROLES = new Set(['expert', 'craftsman', 'business']);

/** Guardrail against a provider turning their profile into a link farm. */
const MAX_METHODS_PER_PROVIDER = 6;

export type PublicPaymentMethod = {
  id: string;
  methodType: string;
  label: string | null;
  details: Record<string, unknown>;
  sortOrder: number;
};

export class ProviderPaymentsService {
  constructor(
    private readonly repo: ProviderPaymentsRepository = new ProviderPaymentsRepository(),
    private readonly activationGate: ActivationGateService = new ActivationGateService(),
  ) {}

  private assertProviderRole(role: string): void {
    if (!PROVIDER_ROLES.has(role)) {
      throw new HttpError({
        statusCode: 403,
        code: 'PROVIDERS_ONLY',
        message: 'Only providers can configure payment methods.',
      });
    }
  }

  private toPublic(row: ProviderPaymentMethodRow): PublicPaymentMethod {
    return {
      id: row.id,
      methodType: row.method_type,
      label: row.label,
      details: row.details,
      sortOrder: row.sort_order,
    };
  }

  // -------------------------------------------------------------------------
  // Provider-facing management
  // -------------------------------------------------------------------------
  async listMine(params: {
    userId: string;
    role: string;
  }): Promise<{ methods: PublicPaymentMethod[]; activeCount: number }> {
    this.assertProviderRole(params.role);
    const rows = await this.repo.listForProvider(params.userId);
    return {
      methods: rows.map((r) => ({ ...this.toPublic(r), isActive: r.is_active })),
      activeCount: rows.filter((r) => r.is_active).length,
    };
  }

  async create(params: {
    userId: string;
    role: string;
    input: UpsertPaymentMethodInput;
  }): Promise<PublicPaymentMethod> {
    this.assertProviderRole(params.role);

    const existing = await this.repo.listForProvider(params.userId);
    if (existing.length >= MAX_METHODS_PER_PROVIDER) {
      throw new HttpError({
        statusCode: 400,
        code: 'TOO_MANY_PAYMENT_METHODS',
        message: `You can save at most ${MAX_METHODS_PER_PROVIDER} payment methods.`,
      });
    }

    try {
      const row = await this.repo.create({
        userId: params.userId,
        methodType: params.input.methodType,
        label: params.input.label ?? null,
        details: params.input.details,
        isActive: params.input.isActive ?? true,
        sortOrder: params.input.sortOrder ?? existing.length,
      });
      return this.toPublic(row);
    } catch (e) {
      // uq_provider_payment_methods_user_type_label
      if (e instanceof Error && /uq_provider_payment_methods_user_type_label/.test(e.message)) {
        throw new HttpError({
          statusCode: 409,
          code: 'DUPLICATE_PAYMENT_METHOD',
          message: 'You already have a payment method of this type with the same label.',
        });
      }
      throw e;
    }
  }

  async update(params: {
    userId: string;
    role: string;
    id: string;
    input: UpsertPaymentMethodInput;
  }): Promise<PublicPaymentMethod> {
    this.assertProviderRole(params.role);

    const existing = await this.repo.findById(params.id);
    if (!existing || existing.user_id !== params.userId) {
      // Same response for "not yours" and "does not exist" — a distinct 403
      // would confirm the id belongs to someone.
      throw new HttpError({
        statusCode: 404,
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found.',
      });
    }
    if (existing.method_type !== params.input.methodType) {
      throw new HttpError({
        statusCode: 400,
        code: 'METHOD_TYPE_IMMUTABLE',
        message: 'Delete this method and add a new one to change its type.',
      });
    }

    const row = await this.repo.update({
      id: params.id,
      userId: params.userId,
      label: params.input.label ?? null,
      details: params.input.details,
      isActive: params.input.isActive ?? true,
      sortOrder: params.input.sortOrder ?? existing.sort_order,
    });
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found.',
      });
    }
    return this.toPublic(row);
  }

  async remove(params: { userId: string; role: string; id: string }): Promise<{ deleted: true }> {
    this.assertProviderRole(params.role);
    const deleted = await this.repo.remove(params.id, params.userId);
    if (!deleted) {
      throw new HttpError({
        statusCode: 404,
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found.',
      });
    }
    return { deleted: true };
  }

  /**
   * Does this provider have somewhere to be paid?
   *
   * Checked BEFORE any MHC is debited (decision D5): a provider must never spend
   * credits to activate a job and only then discover the customer has no way to
   * pay them.
   */
  async assertHasActivePaymentMethod(userId: string): Promise<void> {
    const count = await this.repo.countActive(userId);
    if (count === 0) {
      throw new HttpError({
        statusCode: 409,
        code: 'NO_ACTIVE_PAYMENT_METHOD',
        message:
          'Add a payment method before activating a job, so the customer knows how to pay you. No credits were charged.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Customer-facing disclosure
  // -------------------------------------------------------------------------
  /**
   * Reveal a provider's payment details to the customer of an ACTIVATED award.
   *
   * Three independent checks, in order: the caller owns the need, the award is
   * activated, and the activation belongs to this bid. The disclosure is audited
   * inside the same transaction that reads the details.
   */
  async discloseForAward(params: {
    bidId: string;
    requesterId: string;
  }): Promise<{ methods: PublicPaymentMethod[]; providerUserId: string; disclosedAt: string }> {
    const { rows } = await getPool().query<{
      need_id: string;
      customer_id: string;
      expert_id: string;
    }>(
      `SELECT n.id AS need_id, n.customer_id, b.expert_id
       FROM bids b JOIN needs n ON n.id = b.need_id
       WHERE b.id = $1`,
      [params.bidId],
    );
    const job = rows[0];
    if (!job) {
      throw new HttpError({ statusCode: 404, code: 'BID_NOT_FOUND', message: 'Bid not found.' });
    }

    // Only the CUSTOMER may pull payment details. The provider already knows
    // their own, and nobody else has any business seeing them.
    if (job.customer_id !== params.requesterId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only the customer on this job can view the payment details.',
      });
    }

    // 402 unless the provider has paid to activate this specific bid.
    await this.activationGate.assertAwardActivated(params.bidId);

    const activation = await this.repo.findAwardActivation(params.bidId);
    if (!activation) {
      // Only reachable with the gate kill-switch on: unlocked, but no activation
      // row exists to audit against, so there is nothing to disclose.
      throw new HttpError({
        statusCode: 409,
        code: 'ACTIVATION_NOT_RECORDED',
        message: 'This job has no recorded activation, so payment details cannot be shared yet.',
      });
    }

    const { methods } = await this.repo.discloseForActivation({
      activationId: activation.id,
      providerUserId: activation.provider_user_id,
      customerUserId: params.requesterId,
    });

    return {
      methods: methods.map((m) => this.toPublic(m)),
      providerUserId: activation.provider_user_id,
      disclosedAt: new Date().toISOString(),
    };
  }

  /** A provider's record of who has been shown their payment details. */
  async listMyDisclosures(params: { userId: string; role: string }) {
    this.assertProviderRole(params.role);
    return this.repo.listDisclosuresForProvider(params.userId);
  }
}
