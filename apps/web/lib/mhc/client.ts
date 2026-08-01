import { ApiClientRequestError } from '../auth/client';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

// ---------------------------------------------------------------------------
// MHC (Mohandis Credits) API client
// ---------------------------------------------------------------------------
// MHC is a closed-loop platform credit: non-cashable, non-withdrawable,
// non-transferable, and never convertible back to EGP. Nothing in this module
// should present it as money — no withdrawal, no balance transfer, no escrow.
// ---------------------------------------------------------------------------

export type MhcPackage = {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  mhc_amount: string;
  external_price_amount: string;
  external_price_currency: string;
  is_active: boolean;
  sort_order: number;
};

export type MhcCreditsSummary = {
  balance: number;
  currencyLabel: 'MHC';
  withdrawable: false;
  packages: MhcPackage[];
};

export type MhcTransaction = {
  id: string;
  type: string;
  amount: string;
  balance_delta: string | null;
  balance_after: string;
  status: string;
  description: string | null;
  reference_type: string | null;
  created_at: string;
};

/** Lifecycle of a credit purchase, mapped from `deposit_requests.status`. */
export type MhcPurchaseStatus =
  | 'pending'
  | 'pending_review'
  | 'paid'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'expired';

export type MhcPurchase = {
  id: string;
  order_id: string;
  status: MhcPurchaseStatus;
  provider: string;
  mhc_grant_amount: string | null;
  external_price_amount: string | null;
  external_price_currency: string | null;
  transfer_reference?: string | null;
  rejection_reason?: string | null;
  provider_status?: string | null;
  package_code?: string | null;
  package_name?: string | null;
  checkout_url?: string | null;
  paid_at?: string | null;
  created_at?: string;
};

export type MhcActionPrice = {
  id: string;
  action_key: string;
  name: string;
  mhc_price: string;
  is_active: boolean;
};

export type AwardActivationStatus = {
  activated: boolean;
  requiredMhc: number;
};

export type ProviderPaymentMethodType = 'instapay' | 'mobile_wallet' | 'bank_transfer';

export type ProviderPaymentMethod = {
  id: string;
  methodType: ProviderPaymentMethodType;
  label: string | null;
  details: Record<string, unknown>;
  sortOrder: number;
  isActive?: boolean;
};

export type DisclosedPaymentDetails = {
  methods: ProviderPaymentMethod[];
  providerUserId: string;
  disclosedAt: string;
};

type RequestOptions = {
  accessToken: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
};

async function requestJson<T>({
  accessToken,
  path,
  method = 'GET',
  body,
}: RequestOptions): Promise<T> {
  const response = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      method,
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    accessToken,
  );

  if (!response.ok) {
    const rawErrorBody: unknown = await response.json().catch(() => null);
    const maybeError = rawErrorBody as {
      error?: { code: string; message: string; details?: unknown };
    } | null;
    if (maybeError?.error) {
      throw new ApiClientRequestError({
        code: maybeError.error.code,
        message: maybeError.error.message,
        status: response.status,
        details: maybeError.error.details,
      });
    }
    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }

  const payload = (await response.json()) as { data: T };
  return payload.data;
}

export const mhcApiClient = {
  // -- credits ------------------------------------------------------------
  getCredits: (accessToken: string) =>
    requestJson<MhcCreditsSummary>({ accessToken, path: '/api/credits/me' }),

  getTransactions: (accessToken: string, page = 1, limit = 20) =>
    requestJson<MhcTransaction[]>({
      accessToken,
      path: `/api/credits/me/transactions?page=${page}&limit=${limit}`,
    }),

  getPackages: (accessToken: string) =>
    requestJson<MhcPackage[]>({ accessToken, path: '/api/credits/packages' }),

  getActionPrices: (accessToken: string) =>
    requestJson<MhcActionPrice[]>({ accessToken, path: '/api/credits/action-prices' }),

  getPurchases: (accessToken: string, page = 1, limit = 20) =>
    requestJson<MhcPurchase[]>({
      accessToken,
      path: `/api/credits/purchases?page=${page}&limit=${limit}`,
    }),

  // -- purchase rails -----------------------------------------------------
  getInstapayInfo: (accessToken: string) =>
    requestJson<{ destinationAccount: Record<string, unknown>; packages: MhcPackage[] }>({
      accessToken,
      path: '/api/credits/purchase/instapay/info',
    }),

  submitInstapayPurchase: (
    accessToken: string,
    body: { packageId: string; proofUploadId: string; transferReference: string },
  ) =>
    requestJson<{ id: string; orderId: string; status: string; mhcOnApproval: number }>({
      accessToken,
      path: '/api/credits/purchase/instapay',
      method: 'POST',
      body,
    }),

  createNowPaymentsPurchase: (
    accessToken: string,
    body: { packageId: string; payCurrency?: string },
  ) =>
    requestJson<{ id: string; orderId: string; invoiceUrl: string | null; mhcOnPayment: number }>({
      accessToken,
      path: '/api/credits/purchase/nowpayments',
      method: 'POST',
      body,
    }),

  // -- award activation ---------------------------------------------------
  getAwardActivationStatus: (accessToken: string, bidId: string) =>
    requestJson<AwardActivationStatus>({
      accessToken,
      path: `/api/credits/activations/award/${bidId}`,
    }),

  activateAward: (accessToken: string, bidId: string) =>
    requestJson<{
      mhcCharged: number;
      balance: number;
      alreadyActivated: boolean;
      needId: string;
    }>({
      accessToken,
      path: `/api/credits/activations/award/${bidId}`,
      method: 'POST',
    }),

  declineAward: (accessToken: string, bidId: string) =>
    requestJson<{ needId: string; rejected: true }>({
      accessToken,
      path: `/api/credits/activations/award/${bidId}/decline`,
      method: 'POST',
    }),

  // -- provider payment methods -------------------------------------------
  listPaymentMethods: (accessToken: string) =>
    requestJson<{ methods: ProviderPaymentMethod[]; activeCount: number }>({
      accessToken,
      path: '/api/provider-payments/methods',
    }),

  createPaymentMethod: (accessToken: string, body: unknown) =>
    requestJson<ProviderPaymentMethod>({
      accessToken,
      path: '/api/provider-payments/methods',
      method: 'POST',
      body,
    }),

  updatePaymentMethod: (accessToken: string, id: string, body: unknown) =>
    requestJson<ProviderPaymentMethod>({
      accessToken,
      path: `/api/provider-payments/methods/${id}`,
      method: 'PUT',
      body,
    }),

  deletePaymentMethod: (accessToken: string, id: string) =>
    requestJson<{ deleted: true }>({
      accessToken,
      path: `/api/provider-payments/methods/${id}`,
      method: 'DELETE',
    }),

  /** Customer-only, post-activation. The read is audited server-side. */
  getDisclosedPaymentDetails: (accessToken: string, bidId: string) =>
    requestJson<DisclosedPaymentDetails>({
      accessToken,
      path: `/api/provider-payments/disclosure/award/${bidId}`,
    }),
};
