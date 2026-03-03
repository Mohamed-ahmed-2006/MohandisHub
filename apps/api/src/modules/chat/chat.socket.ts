import type { Server as SocketServer } from 'socket.io';

import { logger } from '../../config/logger.js';

export const registerChatSocket = (io: SocketServer): void => {
  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    socket.emit('chat:welcome', {
      message: 'Welcome to MohandisHub realtime channel.',
      socketId: socket.id,
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket disconnected', {
        socketId: socket.id,
        reason,
      });
    });
  });
};
