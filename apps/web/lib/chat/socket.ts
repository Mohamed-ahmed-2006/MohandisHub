import type { Socket } from 'socket.io-client';

import { getApiBaseUrl } from '@/lib/env';

let socket: Socket | null = null;

export async function getChatSocket(accessToken?: string): Promise<Socket | null> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;

  if (!socket) {
    const { io } = await import('socket.io-client');
    socket = io(baseUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }

  if (accessToken) {
    socket.auth = { token: accessToken };
    if (!socket.connected) {
      socket.connect();
    }
  }

  return socket;
}

export function disconnectChatSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
