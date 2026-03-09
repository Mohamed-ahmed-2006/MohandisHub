import { getApiBaseUrl } from '@/lib/env';

export type Need = {
  id: string;
  customer_id: string;
  title: string;
  description: string;
  category_id: string | null;
  budget_type: 'fixed' | 'hourly';
  budget_amount: string;
  currency: string;
  timeline_days: number | null;
  city: string | null;
  country: string | null;
  reference_url?: string | null;
  status: string;
  awarded_bid_id: string | null;
  created_at: string;
  customer_name?: string;
  category_name_en?: string;
  category_name_ar?: string;
  bid_count?: string;
};

export type Bid = {
  id: string;
  need_id: string;
  expert_id: string;
  amount: string;
  currency: string;
  message: string;
  delivery_days: number | null;
  estimated_hours: number | null;
  status: string;
  created_at: string;
  expert_name?: string;
  expert_email?: string;
  need_title?: string;
  has_unread?: boolean;
};

async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- res.json() returns any
    const body = await res.json().catch(() => ({}));
    const err = body as { error?: { message?: string; details?: unknown } };
    const msg = err?.error?.message ?? 'Request failed';
    const details = err?.error?.details;
    const e = new Error(msg) as Error & { details?: unknown };
    e.details = details;
    throw e;
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export const needsApiClient = {
  createNeed: (
    token: string,
    body: {
      title: string;
      description: string;
      categoryId?: string;
      budgetType: string;
      budgetAmount: number;
      currency?: string;
      timelineDays?: number;
      city?: string;
      country?: string;
      referenceUrl?: string;
      referenceUrls?: string[];
    },
  ) => apiReq<Need>('/api/needs', token, { method: 'POST', body: JSON.stringify(body) }),

  listMyNeeds: (token: string, page = 1) =>
    apiReq<{ rows: Need[]; total: number }>(`/api/needs/my?page=${page}`, token),

  listOpenNeeds: (token: string, page = 1, categoryId?: string) =>
    apiReq<{ rows: Need[]; total: number }>(
      `/api/needs?page=${page}${categoryId ? `&categoryId=${categoryId}` : ''}`,
      token,
    ),

  getNeed: (token: string, id: string) => apiReq<Need>(`/api/needs/${id}`, token),

  updateNeed: (token: string, id: string, body: { status?: string }) =>
    apiReq<Need>(`/api/needs/${id}`, token, { method: 'PATCH', body: JSON.stringify(body) }),

  awardBid: (token: string, needId: string, bidId: string) =>
    apiReq<{ needId: string; bidId: string; status: string }>(`/api/needs/${needId}/award`, token, {
      method: 'POST',
      body: JSON.stringify({ bidId }),
    }),

  payBid: (token: string, needId: string, bidId: string) =>
    apiReq<{ needId: string; bidId: string; paid: boolean }>(`/api/needs/${needId}/bids/${bidId}/pay`, token, {
      method: 'POST',
    }),

  createBid: (
    token: string,
    needId: string,
    body: { amount: number; message: string; deliveryDays?: number; estimatedHours?: number },
  ) =>
    apiReq<Bid>(`/api/needs/${needId}/bids`, token, { method: 'POST', body: JSON.stringify(body) }),

  updateBid: (
    token: string,
    needId: string,
    bidId: string,
    body: { amount?: number; message?: string; deliveryDays?: number; estimatedHours?: number },
  ) =>
    apiReq<Bid>(`/api/needs/${needId}/bids/${bidId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteBid: (token: string, needId: string, bidId: string) =>
    apiReq<void>(`/api/needs/${needId}/bids/${bidId}`, token, { method: 'DELETE' }),

  listBidsForNeed: (token: string, needId: string) =>
    apiReq<Bid[]>(`/api/needs/${needId}/bids`, token),

  listMyBids: (token: string, page = 1) =>
    apiReq<{ rows: Bid[]; total: number }>(`/api/bids/my?page=${page}`, token),

  listBidMessages: (token: string, needId: string, bidId: string) =>
    apiReq<any[]>(`/api/needs/${needId}/bids/${bidId}/messages`, token),

  createBidMessage: (token: string, needId: string, bidId: string, content: string) =>
    apiReq<any>(`/api/needs/${needId}/bids/${bidId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
};
