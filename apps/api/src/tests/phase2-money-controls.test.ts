import { readFileSync } from 'node:fs';

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { requireAdminPermission } from '../middleware/require-role.js';
import type {
  ReservationActionIdempotencyRow,
  ReservationRow,
} from '../modules/reservations/reservations.repository.js';
import { ReservationsService } from '../modules/reservations/reservations.service.js';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const makeReq = (adminPermissions: string[]): Request =>
  ({
    user: {
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'customer',
      isAdmin: true,
      adminPermissions,
      plan: 'free',
      emailVerified: true,
      verified: true,
    },
  }) as unknown as Request;

const makeReservationRow = (overrides: Partial<ReservationRow> = {}): ReservationRow => ({
  id: 'reservation-1',
  customer_id: 'customer-1',
  provider_id: 'provider-1',
  purpose: 'service',
  job_id: null,
  job_application_id: null,
  service_id: 'service-1',
  slot_id: 'slot-1',
  mode: 'online',
  online_type: 'voice',
  status: 'pending',
  requested_start_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  requested_end_at: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
  expert_price_amount: '50',
  currency: 'EGP',
  admin_acceptance_fee: '5',
  admin_minute_rate: '0',
  policy_snapshot: null,
  fixed_price_hold_id: 'hold-1',
  rejection_reason: null,
  auto_rejected: false,
  suggested_slots: [],
  conversation_id: null,
  final_location_text: null,
  final_location_lat: null,
  final_location_lng: null,
  accepted_at: null,
  started_at: null,
  ended_at: null,
  completed_at: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_actor: null,
  cancellation_reason_code: null,
  cancellation_effective_outcome: null,
  refund_amount: '0',
  captured_amount: '0',
  penalty_amount: '0',
  refund_status: 'none',
  settlement_status: 'held',
  customer_done_due_at: null,
  done_prompted_at: null,
  disconnect_auto_release_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  provider_name: 'Provider',
  customer_name: 'Customer',
  service_title: 'Service',
  ...overrides,
});

describe('phase 2 admin money controls', () => {
  it('enforces scoped admin permissions while preserving super-admin access', () => {
    const middleware = requireAdminPermission('manage_support');
    const res = {} as Response;
    const allowedNext = vi.fn() as unknown as NextFunction;
    const deniedNext = vi.fn() as unknown as NextFunction;
    const superNext = vi.fn() as unknown as NextFunction;
    const emptyNext = vi.fn() as unknown as NextFunction;

    middleware(makeReq(['manage_support']), res, allowedNext);
    expect(() => middleware(makeReq(['manage_users']), res, deniedNext)).toThrow(
      'You do not have permission to perform this action.',
    );
    expect(() => middleware(makeReq([]), res, emptyNext)).toThrow(
      'You do not have permission to perform this action.',
    );
    middleware(makeReq(['super_admin']), res, superNext);

    expect(allowedNext).toHaveBeenCalledTimes(1);
    expect(superNext).toHaveBeenCalledTimes(1);
    expect(deniedNext).not.toHaveBeenCalled();
    expect(emptyNext).not.toHaveBeenCalled();
  });

  it('assigns dedicated permissions to admin-like support, media, ads, and reservation money routes', () => {
    const adminRoutes = readSource('../modules/admin/admin.routes.ts');
    const mediaRoutes = readSource('../modules/media/media.routes.ts');
    const adsRoutes = readSource('../modules/advertisements/advertisements.routes.ts');
    const reservationRoutes = readSource('../modules/reservations/reservations.routes.ts');

    expect(adminRoutes).toContain("requireAdminPermission('manage_support')");
    expect(adminRoutes).toContain("requireAdminPermission('super_admin')");
    expect(mediaRoutes).toContain("requireAdminPermission('manage_media')");
    expect(adsRoutes).toContain("requireAdminPermission('manage_ads')");
    expect(adsRoutes).toContain("requireAdminPermission('manage_ad_pricing')");
    expect(adsRoutes).toContain("requireAdminPermission('manage_ad_scheduling')");
    expect(reservationRoutes).toContain("requireAdminPermission('manage_transactions')");
  });

  it('passes admin-flag users through reservation admin service checks', () => {
    const reservationsController = readSource('../modules/reservations/reservations.controller.ts');

    expect(reservationsController).toContain('function reservationAdminRole');
    expect(reservationsController).toContain(
      "return user.isAdmin ? 'admin' : (user.role ?? 'customer')",
    );
    expect(reservationsController).toMatch(
      /svc\.listDisputes\(\s*user\.id,\s*reservationAdminRole\(user\)/,
    );
    expect(reservationsController).toMatch(
      /svc\.resolveDispute\(\s*user\.id,\s*reservationAdminRole\(user\)/,
    );
    expect(reservationsController).toMatch(
      /svc\.listActionFailures\(\s*user\.id,\s*reservationAdminRole\(user\)/,
    );
    expect(reservationsController).toMatch(
      /svc\.replayActionFailure\(\s*user\.id,\s*reservationAdminRole\(user\)/,
    );
    expect(reservationsController).toMatch(
      /svc\.reconcileReservationMoney\(\s*user\.id,\s*reservationAdminRole\(user\)/,
    );
  });

  it('keeps audit hooks on critical admin and money-control actions', () => {
    const adminController = readSource('../modules/admin/admin.controller.ts');
    const adsController = readSource('../modules/advertisements/advertisements.controller.ts');
    const reservationsController = readSource('../modules/reservations/reservations.controller.ts');
    const mediaRoutes = readSource('../modules/media/media.routes.ts');
    const profilesService = readSource('../modules/profiles/profiles.service.ts');

    for (const action of [
      'admin.wallet.adjust',
      'admin.wallet.transaction.reverse',
      'admin.wallet.manual_deposit.approve',
      'admin.wallet.manual_withdrawal.complete',
      'admin.user.update',
      'admin.service.approve',
      'admin.settings.update',
      'admin.support_ticket.update',
    ]) {
      expect(adminController).toContain(action);
    }
    expect(adsController).toContain('admin.ad.pricing_override');
    expect(adsController).toContain('admin.ad.schedule');
    expect(reservationsController).toContain('admin.reservation.reconcile');
    expect(mediaRoutes).toContain('admin.media.create');
    expect(profilesService).toContain('admin.verification.identity_review');
  });

  it('fails production startup for incomplete payment-adjacent providers', () => {
    const envConfig = readSource('../config/env.ts');

    expect(envConfig).toContain("parsed.data.NODE_ENV === 'production'");
    expect(envConfig).toContain("parsed.data.OTP_EMAIL_PROVIDER === 'console'");
    expect(envConfig).toContain("parsed.data.OTP_EMAIL_PROVIDER === 'sendgrid'");
    expect(envConfig).toContain("parsed.data.OTP_SMS_PROVIDER === 'http_adapter'");
    expect(envConfig).toContain("parsed.data.OTP_SMS_PROVIDER === 'meta_whatsapp'");
    expect(envConfig).toContain("parsed.data.VERIFICATION_PROVIDER === 'idenfy'");
    expect(envConfig).toContain('Production provider configuration failed');
  });

  it('requires wallet money proof uploads to belong to the expected actor', () => {
    const walletService = readSource('../modules/wallet/wallet.service.ts');
    const walletRepository = readSource('../modules/wallet/wallet.repository.ts');

    expect(walletRepository).toContain('privateUploadBelongsToUser');
    expect(walletService).toContain('params.proofUploadId');
    expect(walletService).toContain('privateUploadBelongsToUser');
    expect(walletService).toContain('INVALID_PROOF_UPLOAD');
    expect(walletRepository).toContain('WHERE id = $1 AND user_id = $2');
    expect(walletRepository).toContain('[params.proofUploadId, params.adminId]');
  });

  it('scopes admin private-upload reads to sensitive-file permissions', () => {
    const uploadRoutes = readSource('../modules/upload/upload.routes.ts');

    expect(uploadRoutes).toContain('loadAdminFromDb');
    expect(uploadRoutes).toContain('function canAdminReadPrivateUpload');
    expect(uploadRoutes).toContain("hasAdminPermission(user, 'manage_verifications')");
    expect(uploadRoutes).toContain("hasAdminPermission(user, 'manage_transactions')");
    expect(uploadRoutes).toContain('!canAdminReadPrivateUpload(user)');
  });

  it('hardens auth lockdown, refresh/logout origin checks, and admin power changes', () => {
    const authService = readSource('../modules/auth/auth.service.ts');
    const authenticate = readSource('../middleware/authenticate.ts');
    const authRoutes = readSource('../modules/auth/auth.routes.ts');
    const adminController = readSource('../modules/admin/admin.controller.ts');
    const adminService = readSource('../modules/admin/admin.service.ts');
    const chatSocket = readSource('../modules/chat/chat.socket.ts');
    const usersService = readSource('../modules/users/users.service.ts');

    expect(authService).toContain('status.signupsLocked');
    expect(authService).toContain('status.lockLogins');
    expect(authService).toContain("user.admin_permissions.includes('super_admin')");
    expect(authService).toContain(
      'If your email is registered, a password reset link has been sent.',
    );
    expect(authenticate).toContain('SELECT primary_role');
    expect(authenticate).toContain('admin_permissions');
    expect(authenticate).toContain('email_verified_at');
    expect(usersService).toContain('EMAIL_CHANGE_MAX_CONFIRM_ATTEMPTS');
    expect(usersService).toContain('EMAIL_CHANGE_ATTEMPTS_EXCEEDED');
    expect(authRoutes).toContain('requireTrustedAuthOrigin');
    expect(adminController).toContain('SUPER_ADMIN_REQUIRED');
    expect(adminController).toContain('SELF_ADMIN_CHANGE_FORBIDDEN');
    expect(adminService).toContain('revokeExistingSessions');
    expect(adminService).toContain('revokeAllUserTokens(userId)');
    expect(chatSocket).toContain('isUserActive');
  });

  it('restricts payment checkout return URLs to configured web origins', () => {
    const walletService = readSource('../modules/wallet/wallet.service.ts');

    expect(walletService).toContain('resolveTrustedWebReturnBase');
    expect(walletService).toContain('new URL(returnUrl)');
    expect(walletService).toContain('allowedOrigins.includes(candidate.origin)');
    expect(walletService).toContain('CORS_EXTRA_ORIGINS');
  });

  it('keeps card deposits disabled by default while preserving future payment method keys', () => {
    const appSettings = readSource('../../../../packages/shared/src/app-settings.ts');
    const migration = readSource(
      '../../../../supabase/migrations/20260604170000_disable_card_deposits_launch_default.sql',
    );
    const adminSettingsTab = readSource(
      '../../../../apps/web/components/admin/admin-settings-tab.tsx',
    );

    expect(appSettings).toContain("key: 'deposit_card'");
    expect(appSettings).toContain('defaultEnabled: false');
    expect(appSettings).toContain('PAYMENT_METHOD_DEFINITIONS');
    expect(appSettings).toContain('out[k] = v');
    expect(migration).toContain("'deposit_card', false");
    expect(migration).toContain('disable_card_deposits = true');
    expect(adminSettingsTab).toContain('PAYMENT_METHOD_DEFINITIONS');
    expect(adminSettingsTab).toContain('Future/custom method key');
  });

  it('returns the stored reservation for duplicate create requests with the same idempotency key', async () => {
    const reservation = makeReservationRow();
    const repo = {
      findActionIdempotency: vi
        .fn<() => Promise<ReservationActionIdempotencyRow | null>>()
        .mockResolvedValue({
          id: 'idem-1',
          actor_id: 'customer-1',
          action: 'create_reservation',
          idempotency_key: 'create-provider-1-slot-1',
          reservation_id: reservation.id,
          response_json: {},
          created_at: new Date().toISOString(),
        }),
      findReservationById: vi.fn().mockResolvedValue(reservation),
    };
    const service = new ReservationsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.createReservation(
      'customer-1',
      {
        providerId: 'provider-1',
        serviceId: 'service-1',
        slotId: 'slot-1',
        mode: 'online',
        onlineType: 'voice',
      },
      'create-provider-1-slot-1',
    );

    expect(repo.findActionIdempotency).toHaveBeenCalledWith(
      'customer-1',
      'create_reservation',
      'create-provider-1-slot-1',
    );
    expect(result.id).toBe('reservation-1');
    expect(result.fixedPriceHoldId).toBe('hold-1');
  });
});
