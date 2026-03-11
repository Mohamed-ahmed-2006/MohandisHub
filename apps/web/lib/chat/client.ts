import { getApiBaseUrl } from '@/lib/env';

export type Conversation = {
  id: string;
  participant_a: string;
  participant_b: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  other_user_id: string;
  other_display_name: string;
  other_email: string;
  last_message_body: string | null;
  has_unread?: boolean;
};

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
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error('Request failed');
  const json = (await res.json()) as { data: T };
  return json.data;
}

export const chatApiClient = {
  listConversations: (token: string) => apiReq<Conversation[]>('/api/chat/conversations', token),

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
