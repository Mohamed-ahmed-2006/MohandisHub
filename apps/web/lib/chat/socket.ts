import { io, type Socket } from 'socket.io-client';

import { getApiBaseUrl } from '@/lib/env';

let socket: Socket | null = null;

export function getChatSocket(accessToken?: string): Socket | null {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;
  if (!socket) {
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
