import type {
  ApiSuccessBody,
  CreateSupportTicketBody,
  ReplySupportTicketBody,
  SupportTicket,
  SupportTicketMessage,
} from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

async function apiReq<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body?.error?.message ?? 'Request failed');
  }
  const json = (await res.json()) as ApiSuccessBody<T>;
  return json.data;
}

export const supportApiClient = {
  createTicket: (token: string, body: CreateSupportTicketBody): Promise<SupportTicket> =>
    apiReq('/api/support/tickets', token, { method: 'POST', body: JSON.stringify(body) }),

  listMyTickets: (
    token: string,
    params?: { page?: number; limit?: number },
  ): Promise<{ items: SupportTicket[]; total: number; page: number; limit: number; totalPages: number }> => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return apiReq(`/api/support/tickets${qs ? `?${qs}` : ''}`, token);
  },

  getTicket: (token: string, ticketId: string): Promise<SupportTicket> =>
    apiReq(`/api/support/tickets/${ticketId}`, token),

  listMessages: (token: string, ticketId: string): Promise<SupportTicketMessage[]> =>
    apiReq(`/api/support/tickets/${ticketId}/messages`, token),

  reply: (token: string, ticketId: string, body: ReplySupportTicketBody): Promise<SupportTicketMessage> =>
    apiReq(`/api/support/tickets/${ticketId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
