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
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender_name: string;
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

  sendMessage: (token: string, convId: string, body: string) =>
    apiReq<Message>(`/api/chat/conversations/${convId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  startConversation: (token: string, otherUserId: string) =>
    apiReq<{ conversationId: string }>('/api/chat/conversations', token, {
      method: 'POST',
      body: JSON.stringify({ otherUserId }),
    }),
};
