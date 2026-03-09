// ---------------------------------------------------------------------------
// Bookings service — business logic
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { ServicesRepository } from '../services/services.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { BookingsRepository } from './bookings.repository.js';
import type { BookingRow } from './bookings.repository.js';
import type { CreateBookingInput, UpdateBookingInput } from './bookings.validation.js';

function toBooking(row: BookingRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    providerId: row.provider_id,
    serviceId: row.service_id,
    needId: row.need_id,
    amount: parseFloat(row.amount),
    currency: row.currency,
    commissionAmount: parseFloat(row.commission_amount),
    providerAmount: parseFloat(row.provider_amount),
    status: row.status as import('@mohandishub/shared').BookingStatus,
    slotStartAt: row.slot_start_at,
    slotEndAt: row.slot_end_at,
    paymentTransactionId: row.payment_transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    serviceTitle: row.service_title,
    providerName: row.provider_name,
    customerName: row.customer_name,
  };
}

export class BookingsService {
  constructor(
    private readonly repo: BookingsRepository = new BookingsRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly servicesRepo: ServicesRepository = new ServicesRepository(),
  ) {}

  async create(customerId: string, input: CreateBookingInput) {
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Bookings are temporarily disabled.',
      });
    }

    const service = await this.servicesRepo.getServiceById(input.serviceId);
    if (!service || service.status !== 'active') {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found or not available.',
      });
    }

    const amount = service.price != null ? parseFloat(service.price) : 0;
    if (amount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SERVICE_PRICE',
        message: 'Service has no valid price.',
      });
    }

    const commissionPercent = status.commissionPercent ?? 10;
    const commissionMinEgp = status.commissionMinEgp ?? 0;
    const commission = Math.max(amount * (commissionPercent / 100), commissionMinEgp);
    const providerAmount = amount - commission;

    const customerWallet = await this.walletRepo.findByUserId(customerId);
    if (!customerWallet) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: 'You need a wallet with sufficient balance. Please deposit first.',
      });
    }
    const customerBalance = parseFloat(customerWallet.balance);
    if (customerBalance < amount) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance. Required: ${amount} ${service.currency}, available: ${customerBalance}.`,
      });
    }

    let providerWallet = await this.walletRepo.findByUserId(service.provider_id);
    if (!providerWallet) {
      providerWallet = await this.walletRepo.createForUser(service.provider_id);
    }

    const slotStart = new Date(input.slotStartAt);
    const slotEnd = new Date(input.slotEndAt);
    if (slotEnd <= slotStart) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SLOT',
        message: 'Slot end must be after slot start.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const receiverId = '00000000-0000-0000-0000-000000000001';
      const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(client, receiverId);

      const { rows: insRows } = await client.query<{ id: string }>(
        `INSERT INTO bookings (customer_id, provider_id, service_id, amount, currency, commission_amount, provider_amount, status, slot_start_at, slot_end_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_payment', $8, $9)
         RETURNING id`,
        [
          customerId,
          service.provider_id,
          input.serviceId,
          amount,
          service.currency ?? 'EGP',
          commission,
          providerAmount,
          slotStart,
          slotEnd,
        ],
      );
      const bookingId = insRows[0]!.id;

      const paymentTxId = await this.walletRepo.debitWalletInTransaction(
        client,
        customerWallet.id,
        customerId,
        amount,
        `Booking: ${service.title}`,
        'booking',
        bookingId,
      );
      await this.walletRepo.creditWithTypeInTransaction(
        client,
        providerWallet.id,
        service.provider_id,
        providerAmount,
        'payment',
        `Earned from booking: ${service.title}`,
        'booking',
        bookingId,
      );
      if (commission > 0) {
        await this.walletRepo.creditWithTypeInTransaction(
          client,
          platformWalletId,
          receiverId,
          commission,
          'commission',
          'Commission from booking',
          'booking',
          bookingId,
        );
      }

      await client.query(
        `UPDATE bookings SET status = 'paid', payment_transaction_id = $1 WHERE id = $2`,
        [paymentTxId, bookingId],
      );

      const { rows } = await client.query<BookingRow>(
        `SELECT b.*, s.title AS service_title,
          COALESCE(up.display_name, up.email) AS provider_name,
          COALESCE(uc.display_name, uc.email) AS customer_name
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         JOIN users up ON up.id = b.provider_id
         JOIN users uc ON uc.id = b.customer_id
         WHERE b.id = $1`,
        [bookingId],
      );
      await client.query('COMMIT');
      const row = rows[0]!;
      return toBooking(row);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance. Please deposit first.',
        });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async listMy(userId: string, role: 'customer' | 'provider', page: number, limit: number) {
    const { rows, total } = await this.repo.listByUser(userId, role, page, limit);
    return {
      items: rows.map(toBooking),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(id: string, userId: string) {
    const booking = await this.repo.findById(id);
    if (!booking) {
      throw new HttpError({
        statusCode: 404,
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }
    if (booking.customer_id !== userId && booking.provider_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Not your booking.',
      });
    }
    return toBooking(booking);
  }

  async update(id: string, userId: string, input: UpdateBookingInput) {
    const booking = await this.repo.findById(id);
    if (!booking) {
      throw new HttpError({
        statusCode: 404,
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      });
    }
    if (booking.customer_id !== userId && booking.provider_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Not your booking.',
      });
    }

    const updated = await this.repo.updateStatus(id, input.status);
    return updated ? toBooking(updated) : null;
  }
}
