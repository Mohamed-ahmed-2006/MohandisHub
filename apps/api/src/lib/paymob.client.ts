// ---------------------------------------------------------------------------
// Paymob client — EGP-native deposits (Unified Intention + checkout + HMAC)
// and payout/disbursement. All provider calls hard-stop with
// PAYMOB_NOT_CONFIGURED until the required env keys are supplied.
// ---------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

import { env } from '../config/env.js';

import { fetchWithTimeout } from './fetch-with-timeout.js';

export const PAYMOB_NOT_CONFIGURED = 'PAYMOB_NOT_CONFIGURED';

export class PaymobNotConfiguredError extends Error {
  code = PAYMOB_NOT_CONFIGURED;
  constructor(message = 'Paymob is not configured yet.') {
    super(message);
    this.name = 'PaymobNotConfiguredError';
  }
}

export class PaymobApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, payload: unknown) {
    super(toErrorMessage(status, payload));
    this.name = 'PaymobApiError';
    this.status = status;
    this.payload = payload;
  }
}

function toErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const message =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.detail === 'string' && obj.detail) ||
      (typeof obj.error === 'string' && obj.error) ||
      '';
    if (message) return `Paymob API error (${status}): ${message}`;
  }
  return `Paymob API error (${status}).`;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function isPaymobDepositConfigured(): boolean {
  return Boolean(
    env.PAYMOB_DEPOSITS_ENABLED &&
    env.PAYMOB_SECRET_KEY &&
    env.PAYMOB_PUBLIC_KEY &&
    env.PAYMOB_HMAC_SECRET &&
    env.PAYMOB_INTEGRATION_IDS,
  );
}

export function isPaymobPayoutConfigured(): boolean {
  return Boolean(
    env.PAYMOB_WITHDRAWALS_ENABLED &&
    env.PAYMOB_PAYOUT_CLIENT_ID &&
    env.PAYMOB_PAYOUT_CLIENT_SECRET &&
    env.PAYMOB_PAYOUT_BASE_URL,
  );
}

function parseIntegrationIds(): number[] {
  if (!env.PAYMOB_INTEGRATION_IDS) return [];
  return env.PAYMOB_INTEGRATION_IDS.split(',')
    .map((id) => Number.parseInt(id.trim(), 10))
    .filter((id) => Number.isFinite(id));
}

export type PaymobBillingData = {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
};

export type CreatePaymobIntentionParams = {
  /** Amount in EGP; converted to piasters (amount_cents) internally. */
  amountEgp: number;
  specialReference: string;
  billingData: PaymobBillingData;
  notificationUrl: string;
  redirectionUrl: string;
};

export type CreatePaymobIntentionResult = {
  clientSecret: string;
  intentionId: string;
  checkoutUrl: string;
};

/**
 * Create a Paymob Unified Intention and return the hosted checkout URL.
 * Throws {@link PaymobNotConfiguredError} until the deposit keys are set.
 */
export async function createPaymobIntention(
  params: CreatePaymobIntentionParams,
): Promise<CreatePaymobIntentionResult> {
  if (!isPaymobDepositConfigured()) throw new PaymobNotConfiguredError();
  const integrationIds = parseIntegrationIds();
  if (integrationIds.length === 0)
    throw new PaymobNotConfiguredError('No Paymob integration ids configured.');

  const amountCents = Math.round(params.amountEgp * 100);
  const res = await fetchWithTimeout(`${env.PAYMOB_API_BASE_URL}/v1/intention/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${env.PAYMOB_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountCents,
      currency: 'EGP',
      payment_methods: integrationIds,
      special_reference: params.specialReference,
      notification_url: params.notificationUrl,
      redirection_url: params.redirectionUrl,
      billing_data: params.billingData,
    }),
  });
  const body = (await parseJsonSafe(res)) as {
    client_secret?: string;
    id?: string | number;
  } | null;
  if (!res.ok || !body?.client_secret) {
    throw new PaymobApiError(res.status, body);
  }
  return {
    clientSecret: body.client_secret,
    intentionId: body.id != null ? String(body.id) : '',
    checkoutUrl: buildPaymobCheckoutUrl(body.client_secret),
  };
}

export function buildPaymobCheckoutUrl(clientSecret: string): string {
  const publicKey = env.PAYMOB_PUBLIC_KEY ?? '';
  return `${env.PAYMOB_API_BASE_URL}/unifiedcheckout/?publicKey=${encodeURIComponent(
    publicKey,
  )}&clientSecret=${encodeURIComponent(clientSecret)}`;
}

// Field order required by Paymob for transaction-callback HMAC (SHA-512).
const PAYMOB_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

function readPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function toHmacValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  return '';
}

/**
 * Verify Paymob's transaction-callback HMAC over the canonical field order.
 * `transaction` is the `obj` from the callback payload.
 */
export function verifyPaymobHmac(
  transaction: Record<string, unknown>,
  receivedHmac: string | null | undefined,
): boolean {
  if (!receivedHmac || !env.PAYMOB_HMAC_SECRET) return false;
  const concatenated = PAYMOB_HMAC_FIELDS.map((field) =>
    toHmacValue(readPath(transaction, field)),
  ).join('');
  const digest = createHmac('sha512', env.PAYMOB_HMAC_SECRET)
    .update(concatenated)
    .digest('hex')
    .toLowerCase();
  return digest === receivedHmac.toLowerCase();
}

// ---------------------------------------------------------------------------
// Payout / disbursement (scaffold) — separate Paymob product/credentials.
// ---------------------------------------------------------------------------

export async function authenticatePaymobPayout(): Promise<string> {
  if (!isPaymobPayoutConfigured())
    throw new PaymobNotConfiguredError('Paymob payouts are not configured yet.');
  const res = await fetchWithTimeout(`${env.PAYMOB_PAYOUT_BASE_URL}/api/secure/o/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.PAYMOB_PAYOUT_CLIENT_ID,
      client_secret: env.PAYMOB_PAYOUT_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  const body = (await parseJsonSafe(res)) as { access_token?: string } | null;
  if (!res.ok || !body?.access_token) {
    throw new PaymobApiError(res.status, body);
  }
  return body.access_token;
}

export type PaymobDisbursementParams = {
  amountEgp: number;
  recipient: string;
  reference: string;
};

export type PaymobDisbursementResult = {
  reference: string;
  status: string;
};

export async function createPaymobDisbursement(
  accessToken: string,
  params: PaymobDisbursementParams,
): Promise<PaymobDisbursementResult> {
  if (!isPaymobPayoutConfigured())
    throw new PaymobNotConfiguredError('Paymob payouts are not configured yet.');
  const res = await fetchWithTimeout(`${env.PAYMOB_PAYOUT_BASE_URL}/api/secure/disburse/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: params.amountEgp,
      msisdn: params.recipient,
      reference: params.reference,
    }),
  });
  const body = (await parseJsonSafe(res)) as {
    transaction_id?: string | number;
    reference?: string;
    disbursement_status?: string;
    status?: string;
  } | null;
  if (!res.ok || !body) {
    throw new PaymobApiError(res.status, body);
  }
  return {
    reference: body.reference != null ? String(body.reference) : params.reference,
    status: body.disbursement_status ?? body.status ?? 'pending',
  };
}
