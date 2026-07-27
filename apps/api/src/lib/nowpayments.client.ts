// ---------------------------------------------------------------------------
// NOWPayments client - deposits, payouts, auth and IPN verification
// ---------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

import { env } from '../config/env.js';

import { fetchWithTimeout } from './fetch-with-timeout.js';

const NOWPAYMENTS_BASE = env.NOWPAYMENTS_API_BASE_URL.replace(/\/+$/, '');

type NowPaymentsInvoicePayload = {
  price_amount: number;
  price_currency: string;
  pay_currency?: string;
  ipn_callback_url?: string;
  order_id?: string;
  order_description?: string;
  success_url?: string;
  cancel_url?: string;
  partially_paid_url?: string;
  is_fixed_rate?: boolean;
  is_fee_paid_by_user?: boolean;
};

type NowPaymentsInvoiceResponse = {
  id: string | number;
  token_id?: string | null;
  order_id?: string | null;
  invoice_url?: string | null;
  pay_currency?: string | null;
  price_amount?: string | number | null;
  price_currency?: string | null;
};

type NowPaymentsCurrenciesResponse = {
  currencies: string[];
};

type NowPaymentsFullCurrenciesResponse = {
  currencies: Array<{
    code?: string;
    enable?: boolean;
  }>;
};

type NowPaymentsAuthResponse = {
  token: string;
};

type NowPaymentsPayoutWithdrawal = {
  address: string;
  currency: string;
  amount: number;
  extra_id?: string | null;
  ipn_callback_url?: string;
};

type NowPaymentsCreatePayoutPayload = {
  payout_description?: string;
  ipn_callback_url?: string;
  withdrawals: NowPaymentsPayoutWithdrawal[];
};

type NowPaymentsCreatePayoutResponse = {
  id?: string | number;
  batch_withdrawal_id?: string | number;
  withdrawal_id?: string | number;
  status?: string;
  withdrawals?: Array<{
    id?: string | number;
    batch_withdrawal_id?: string | number;
    status?: string;
  }>;
};

type NowPaymentsVerifyPayoutResponse = {
  success?: boolean;
  message?: string;
};

type NowPaymentsEstimateResponse = {
  currency_from?: string;
  amount_from?: number | string;
  currency_to?: string;
  estimated_amount?: number | string;
  rate?: number | string;
};

export class NowPaymentsApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown) {
    super(toErrorMessage(status, payload));
    this.name = 'NowPaymentsApiError';
    this.status = status;
    this.payload = payload;
  }
}

function toErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const message =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.error === 'string' && obj.error) ||
      (typeof obj.result === 'string' && obj.result) ||
      '';
    if (message) return `NOWPayments API error (${status}): ${message}`;
  }
  return `NOWPayments API error (${status}).`;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = sortObjectDeep(input[key]);
    return out;
  }
  return value;
}

export function normalizeNowPaymentsApiKey(apiKey: string): string {
  return apiKey.startsWith('api:') ? apiKey.slice(4) : apiKey;
}

export function verifyNowPaymentsIpnSignature(
  rawBody: string,
  signatureHeader: string,
  ipnSecret: string,
): boolean {
  if (!signatureHeader || !ipnSecret) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const sorted = sortObjectDeep(parsed);
  const canonical = JSON.stringify(sorted);
  const digest = createHmac('sha512', ipnSecret).update(canonical).digest('hex').toLowerCase();
  return digest === signatureHeader.toLowerCase();
}

export async function getAvailableCurrencies(apiKey: string): Promise<string[]> {
  const normalized = normalizeNowPaymentsApiKey(apiKey);
  const res = await fetchWithTimeout(`${NOWPAYMENTS_BASE}/currencies`, {
    method: 'GET',
    headers: { 'x-api-key': normalized },
  });
  const payload = (await parseJsonSafe(res)) as NowPaymentsCurrenciesResponse | null;
  if (!res.ok) {
    throw new NowPaymentsApiError(res.status, payload);
  }
  return Array.isArray(payload?.currencies) ? payload.currencies : [];
}

export async function getAvailableCurrenciesDetailed(apiKey: string): Promise<string[]> {
  const normalized = normalizeNowPaymentsApiKey(apiKey);
  const res = await fetchWithTimeout(`${NOWPAYMENTS_BASE}/full-currencies`, {
    method: 'GET',
    headers: { 'x-api-key': normalized },
  });
  const payload = (await parseJsonSafe(res)) as NowPaymentsFullCurrenciesResponse | null;
  if (!res.ok) {
    throw new NowPaymentsApiError(res.status, payload);
  }
  const rows = Array.isArray(payload?.currencies) ? payload.currencies : [];
  return rows
    .filter((row) => row.enable !== false && typeof row.code === 'string')
    .map((row) => (row.code as string).toUpperCase());
}

export async function createInvoice(
  apiKey: string,
  payload: NowPaymentsInvoicePayload,
  originIp?: string,
): Promise<NowPaymentsInvoiceResponse> {
  const normalized = normalizeNowPaymentsApiKey(apiKey);
  const headers: Record<string, string> = {
    'x-api-key': normalized,
    'Content-Type': 'application/json',
  };
  if (originIp) headers['origin-ip'] = originIp;
  const res = await fetchWithTimeout(`${NOWPAYMENTS_BASE}/invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = (await parseJsonSafe(res)) as NowPaymentsInvoiceResponse | null;
  if (!res.ok || !body) {
    throw new NowPaymentsApiError(res.status, body);
  }
  return body;
}

export async function authenticateNowPayments(
  email: string,
  password: string,
): Promise<NowPaymentsAuthResponse> {
  const res = await fetchWithTimeout(`${NOWPAYMENTS_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await parseJsonSafe(res)) as NowPaymentsAuthResponse | null;
  if (!res.ok || !body?.token) {
    throw new NowPaymentsApiError(res.status, body);
  }
  return body;
}

export async function createPayout(
  apiKey: string,
  jwtToken: string,
  payload: NowPaymentsCreatePayoutPayload,
): Promise<NowPaymentsCreatePayoutResponse> {
  const normalized = normalizeNowPaymentsApiKey(apiKey);
  const res = await fetchWithTimeout(`${NOWPAYMENTS_BASE}/payout`, {
    method: 'POST',
    headers: {
      'x-api-key': normalized,
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = (await parseJsonSafe(res)) as NowPaymentsCreatePayoutResponse | null;
  if (!res.ok || !body) {
    throw new NowPaymentsApiError(res.status, body);
  }
  return body;
}

export async function verifyPayout(
  apiKey: string,
  jwtToken: string,
  batchWithdrawalId: string,
  verificationCode: string,
): Promise<NowPaymentsVerifyPayoutResponse> {
  const normalized = normalizeNowPaymentsApiKey(apiKey);
  const res = await fetchWithTimeout(`${NOWPAYMENTS_BASE}/payout/${batchWithdrawalId}/verify`, {
    method: 'POST',
    headers: {
      'x-api-key': normalized,
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ verification_code: verificationCode }),
  });
  const body = (await parseJsonSafe(res)) as NowPaymentsVerifyPayoutResponse | null;
  if (!res.ok || !body) {
    throw new NowPaymentsApiError(res.status, body);
  }
  return body;
}

export async function estimatePrice(
  apiKey: string,
  amount: number,
  currencyFrom: string,
  currencyTo: string,
): Promise<NowPaymentsEstimateResponse> {
  const normalized = normalizeNowPaymentsApiKey(apiKey);
  const query = new URLSearchParams({
    amount: String(amount),
    currency_from: currencyFrom.toUpperCase(),
    currency_to: currencyTo.toUpperCase(),
  });

  const res = await fetchWithTimeout(`${NOWPAYMENTS_BASE}/estimate?${query.toString()}`, {
    method: 'GET',
    headers: { 'x-api-key': normalized },
  });
  const body = (await parseJsonSafe(res)) as NowPaymentsEstimateResponse | null;
  if (!res.ok || !body) {
    throw new NowPaymentsApiError(res.status, body);
  }
  return body;
}

export type {
  NowPaymentsInvoicePayload,
  NowPaymentsInvoiceResponse,
  NowPaymentsCreatePayoutPayload,
  NowPaymentsCreatePayoutResponse,
  NowPaymentsVerifyPayoutResponse,
  NowPaymentsEstimateResponse,
};
