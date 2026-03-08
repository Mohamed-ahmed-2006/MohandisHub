import { io, type Socket } from 'socket.io-client';

import { getApiBaseUrl } from '@/lib/env';

let socket: Socket | null = null;

export function getChatSocket(): Socket | null {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;
  if (!socket?.connected) {
    socket = io(baseUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectChatSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
