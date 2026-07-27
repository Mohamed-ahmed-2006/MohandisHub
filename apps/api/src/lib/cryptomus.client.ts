// ---------------------------------------------------------------------------
// Cryptomus API client — create payment, verify webhook sign
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { fetchWithTimeout } from './fetch-with-timeout.js';

const CRYPTOMUS_BASE = 'https://api.cryptomus.com';

export type CryptomusCreatePaymentParams = {
  amount: string;
  currency: string;
  orderId: string;
  urlCallback?: string;
  urlReturn?: string;
  urlSuccess?: string;
  lifetime?: number;
};

export type CryptomusPaymentResponse = {
  state?: number;
  result?: {
    uuid?: string;
    order_id?: string;
    amount?: string;
    currency?: string;
    url?: string;
    expired_at?: number;
  };
};

function buildSign(body: string, apiKey: string): string {
  const base64 = Buffer.from(body, 'utf-8').toString('base64');
  return createHash('md5')
    .update(base64 + apiKey)
    .digest('hex');
}

export function verifyWebhookSign(rawBody: string, signHeader: string, apiKey: string): boolean {
  const expected = buildSign(rawBody, apiKey);
  return signHeader === expected;
}

export async function createPayment(
  params: CryptomusCreatePaymentParams,
  merchantId: string,
  apiKey: string,
): Promise<CryptomusPaymentResponse> {
  const body = {
    amount: params.amount,
    currency: params.currency,
    order_id: params.orderId,
    ...(params.urlCallback && { url_callback: params.urlCallback }),
    ...(params.urlReturn && { url_return: params.urlReturn }),
    ...(params.urlSuccess && { url_success: params.urlSuccess }),
    ...(params.lifetime && { lifetime: params.lifetime }),
  };
  const bodyStr = JSON.stringify(body);
  const sign = buildSign(bodyStr, apiKey);

  const res = await fetchWithTimeout(`${CRYPTOMUS_BASE}/v1/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      merchant: merchantId,
      sign,
    },
    body: bodyStr,
  });

  const data = (await res.json()) as CryptomusPaymentResponse;
  if (!res.ok) {
    throw new Error(`Cryptomus API error: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}
