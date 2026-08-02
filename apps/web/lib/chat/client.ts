import type { ConversationSummary } from '@mohandishub/shared';

import { fetchWithAuthRetry } from '@/lib/auth/fetch-with-auth-retry';
import { getApiBaseUrl } from '@/lib/env';

export type Conversation = ConversationSummary;

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  sender_name: string;
  reply_to_id?: string | null;
  message_type?: 'text' | 'image' | 'voice' | 'link' | 'location';
  attachment_url?: string | null;
  link_url?: string | null;
  location_lat?: number | string | null;
  location_lng?: number | string | null;
  location_label?: string | null;
  deleted_for_sender?: boolean;
  deleted_for_everyone?: boolean;
};

export type SendMessagePayload = {
  body?: string;
  replyToId?: string;
  messageType?: 'text' | 'image' | 'voice' | 'link' | 'location';
  attachmentUrl?: string;
  linkUrl?: string;
  lat?: number;
  lng?: number;
  label?: string;
};

async function apiReq<T>(path: string, accessToken: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuthRetry(
    `${getApiBaseUrl()}${path}`,
    {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(opts?.headers ?? {}),
      },
    },
    accessToken,
  );
  if (!res.ok) throw new Error('Request failed');
  const json = (await res.json()) as { data: T };
  return json.data;
}

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`Invalid conversation summary field: ${field}`);
  return value;
};

const nullableString = (value: unknown, field: string): string | null =>
  value === null ? null : requiredString(value, field);

/**
 * Browser-side defence in depth: retain only the shared public allowlist even if
 * a future API regression accidentally appends an internal repository field.
 */
export const parseConversationSummary = (value: unknown): ConversationSummary => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid conversation summary.');
  }
  const row = value as Record<string, unknown>;
  return {
    id: requiredString(row.id, 'id'),
    status: requiredString(row.status, 'status'),
    last_message_at: nullableString(row.last_message_at, 'last_message_at'),
    created_at: requiredString(row.created_at, 'created_at'),
    other_user_id: requiredString(row.other_user_id, 'other_user_id'),
    other_display_name: requiredString(row.other_display_name, 'other_display_name'),
    last_message_body: nullableString(row.last_message_body, 'last_message_body'),
    has_unread: row.has_unread === true,
  };
};

export const chatApiClient = {
  listConversations: async (token: string) => {
    const rows = await apiReq<unknown[]>('/api/chat/conversations', token);
    return rows.map(parseConversationSummary);
  },

  getMessages: (token: string, convId: string) =>
    apiReq<{ messages: Message[]; status: string }>(
      `/api/chat/conversations/${convId}/messages`,
      token,
    ),

  sendMessage: (token: string, convId: string, payload: string | SendMessagePayload) =>
    apiReq<Message>(`/api/chat/conversations/${convId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify(
        typeof payload === 'string'
          ? { body: payload, messageType: 'text' }
          : {
              body: payload.body,
              replyToId: payload.replyToId,
              messageType: payload.messageType ?? 'text',
              attachmentUrl: payload.attachmentUrl,
              linkUrl: payload.linkUrl,
              lat: payload.lat,
              lng: payload.lng,
              label: payload.label,
            },
      ),
    }),

  deleteMessage: (
    token: string,
    convId: string,
    messageId: string,
    scope: 'for_me' | 'for_everyone',
  ) =>
    apiReq<{ deleted: boolean; scope: string }>(
      `/api/chat/conversations/${convId}/messages/${messageId}?scope=${scope}`,
      token,
      { method: 'DELETE' },
    ),

  startConversation: (token: string, otherUserId: string) =>
    apiReq<{ conversationId: string }>('/api/chat/conversations', token, {
      method: 'POST',
      body: JSON.stringify({ otherUserId }),
    }),
};
