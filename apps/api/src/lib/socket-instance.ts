// ---------------------------------------------------------------------------
// Socket.io server instance — shared for emitting from REST handlers
// ---------------------------------------------------------------------------

import type { Server as SocketServer } from 'socket.io';

let ioInstance: SocketServer | null = null;

export function setSocketServer(io: SocketServer): void {
  ioInstance = io;
}

export function getSocketServer(): SocketServer | null {
  return ioInstance;
}
