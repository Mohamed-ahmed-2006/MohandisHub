import type { Server as SocketServer } from 'socket.io';

import { setSocketServer } from '../../lib/socket-instance.js';
import { logger } from '../../config/logger.js';

export const registerChatSocket = (io: SocketServer): void => {
  setSocketServer(io);
  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    socket.emit('chat:welcome', {
      message: 'Welcome to MohandisHub realtime channel.',
      socketId: socket.id,
    });

    socket.on('join_conversation', (payload: { conversationId?: string }) => {
      const convId = payload?.conversationId;
      if (convId && typeof convId === 'string') {
        socket.join(`conversation:${convId}`);
      }
    });

    socket.on('leave_conversation', (payload: { conversationId?: string }) => {
      const convId = payload?.conversationId;
      if (convId && typeof convId === 'string') {
        socket.leave(`conversation:${convId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', {
        socketId: socket.id,
        reason,
      });
    });
  });
};
