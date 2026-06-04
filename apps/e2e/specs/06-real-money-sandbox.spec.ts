/**
 * Phase 2 real-money readiness journeys.
 *
 * These tests intentionally require sandbox/staging credentials. They do not run against
 * production credentials and are skipped until the environment is explicitly configured.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? process.env.API_BASE_URL;
const customerEmail = process.env.E2E_CUSTOMER_EMAIL;
const customerPassword = process.env.E2E_CUSTOMER_PASSWORD;
const providerEmail = process.env.E2E_PROVIDER_EMAIL;
const providerPassword = process.env.E2E_PROVIDER_PASSWORD;
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const scopedAdminEmail = process.env.E2E_SCOPED_ADMIN_EMAIL;
const scopedAdminPassword = process.env.E2E_SCOPED_ADMIN_PASSWORD;
const payCurrency = process.env.E2E_SANDBOX_PAY_CURRENCY ?? 'USDTTRC20';
const paidProviderId = process.env.E2E_PAID_PROVIDER_ID;
const paidServiceId = process.env.E2E_PAID_SERVICE_ID;
const paidSlotId = process.env.E2E_PAID_SLOT_ID;
const paidReservationMode = process.env.E2E_PAID_RESERVATION_MODE ?? 'online';
const paidReservationOnlineType = process.env.E2E_PAID_RESERVATION_ONLINE_TYPE ?? 'voice';

const sandboxReady = Boolean(
  apiBaseUrl &&
    customerEmail &&
    customerPassword &&
    providerEmail &&
    providerPassword &&
    adminEmail &&
    adminPassword &&
    scopedAdminEmail &&
    scopedAdminPassword,
);
const paidReservationReady = Boolean(paidProviderId && paidServiceId && paidSlotId);

async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post(`${apiBaseUrl}/api/auth/login`, {
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json() as { data: { tokens: { accessToken: string } } };
  return body.data.tokens.accessToken;
}

async function openAuthed(page: Page, token: string, path: string): Promise<void> {
  await page.addInitScript((accessToken) => {
    window.localStorage.setItem('mohandishub_access_token', accessToken);
  }, token);
  await page.goto(path);
}

test.describe('Phase 2 sandbox money journeys', () => {
  test.skip(!sandboxReady, 'Set E2E_API_BASE_URL and sandbox test account credentials to run real money-flow E2E.');

  test('wallet deposit starts a sandbox checkout and keeps the wallet page usable', async ({ page, request }) => {
    const token = await login(request, customerEmail!, customerPassword!);

    await openAuthed(page, token, '/en/app/settings/wallet');
    await expect(page.locator('body')).toBeVisible();

    const checkout = await request.post(`${apiBaseUrl}/api/wallet/deposit/checkout`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        amount: 100,
        method: 'crypto',
        currency: 'EGP',
        payCurrency,
        returnUrl: `${test.info().project.use.baseURL ?? ''}/en/app/settings/wallet`,
      },
    });
    expect(checkout.ok(), await checkout.text()).toBeTruthy();
    const body = await checkout.json() as {
      data: { checkoutUrl?: string; paymentUrl?: string; orderId?: string };
    };
    expect(body.data.checkoutUrl ?? body.data.paymentUrl).toBeTruthy();
    expect(body.data.orderId).toBeTruthy();
  });

  test('paid booking surfaces request-time wallet hold state for customer and provider', async ({ page, request }) => {
    test.skip(!paidReservationReady, 'Set E2E_PAID_PROVIDER_ID, E2E_PAID_SERVICE_ID, and E2E_PAID_SLOT_ID for paid reservation E2E.');
    const customerToken = await login(request, customerEmail!, customerPassword!);
    const providerToken = await login(request, providerEmail!, providerPassword!);

    await openAuthed(page, customerToken, '/en/app/browse');
    await expect(page.locator('body')).toBeVisible();

    const walletBefore = await request.get(`${apiBaseUrl}/api/wallet/me`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(walletBefore.ok(), await walletBefore.text()).toBeTruthy();

    const reservation = await request.post(`${apiBaseUrl}/api/reservations`, {
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Idempotency-Key': `e2e-paid-reservation-${Date.now()}`,
      },
      data: {
        providerId: paidProviderId,
        serviceId: paidServiceId,
        slotId: paidSlotId,
        mode: paidReservationMode,
        ...(paidReservationMode === 'online' ? { onlineType: paidReservationOnlineType } : {}),
      },
    });
    expect(reservation.ok(), await reservation.text()).toBeTruthy();
    const reservationBody = await reservation.json() as {
      data: {
        id: string;
        fixedPriceHoldId: string | null;
        expertPriceAmount: number;
        settlementStatus: string;
        status: string;
      };
    };
    expect(reservationBody.data.id).toBeTruthy();
    expect(reservationBody.data.expertPriceAmount).toBeGreaterThan(0);
    expect(reservationBody.data.fixedPriceHoldId).toBeTruthy();
    expect(reservationBody.data.settlementStatus).toBe('held');

    const cancel = await request.post(`${apiBaseUrl}/api/reservations/${reservationBody.data.id}/cancel`, {
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Idempotency-Key': `e2e-cancel-paid-reservation-${Date.now()}`,
      },
      data: {
        reasonCode: 'platform_failure',
        reasonText: 'E2E cleanup after paid reservation hold assertion.',
      },
    });
    expect(cancel.ok(), await cancel.text()).toBeTruthy();

    await openAuthed(page, providerToken, '/en/app/bookings');
    await expect(page.locator('body')).toBeVisible();
  });

  test('withdrawal request and admin manual approval surfaces are reachable with sandbox accounts', async ({ page, request }) => {
    const customerToken = await login(request, customerEmail!, customerPassword!);
    const adminToken = await login(request, adminEmail!, adminPassword!);

    const withdrawals = await request.get(`${apiBaseUrl}/api/wallet/withdrawals`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(withdrawals.ok(), await withdrawals.text()).toBeTruthy();

    const manualRails = await request.get(`${apiBaseUrl}/api/admin/wallet/manual-withdrawals`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(manualRails.ok(), await manualRails.text()).toBeTruthy();

    await openAuthed(page, adminToken, '/en/app/admin');
    await expect(page.locator('body')).toBeVisible();
  });

  test('scoped admin cannot see or execute unrelated money-control areas', async ({ page, request }) => {
    const scopedToken = await login(request, scopedAdminEmail!, scopedAdminPassword!);

    await openAuthed(page, scopedToken, '/en/app/admin');
    await expect(page.locator('body')).toBeVisible();

    const support = await request.get(`${apiBaseUrl}/api/admin/support/tickets`, {
      headers: { Authorization: `Bearer ${scopedToken}` },
    });
    const media = await request.get(`${apiBaseUrl}/api/media`, {
      headers: { Authorization: `Bearer ${scopedToken}` },
    });
    const reservationMoney = await request.get(`${apiBaseUrl}/api/reservations/admin/action-failures`, {
      headers: { Authorization: `Bearer ${scopedToken}` },
    });

    expect(support.status(), await support.text()).toBe(403);
    expect(media.status(), await media.text()).toBe(403);
    expect(reservationMoney.status(), await reservationMoney.text()).toBe(200);
  });
});
