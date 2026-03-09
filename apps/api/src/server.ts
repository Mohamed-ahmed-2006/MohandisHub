import { createServer } from 'node:http';

import { Server as SocketServer } from 'socket.io';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { registerChatSocket } from './modules/chat/chat.socket.js';
import { startReservationLifecycleWorker } from './modules/reservations/reservations.lifecycle-worker.js';

const app = createApp();
const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

registerChatSocket(io);
const reservationLifecycleWorker = startReservationLifecycleWorker();

httpServer.listen(env.PORT, () => {
  logger.info('API server started', { port: env.PORT, env: env.NODE_ENV });
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info('Graceful shutdown started', { signal });

  await new Promise<void>((resolve) => {
    httpServer.closeAllConnections();
    void io.close(() => {
      resolve();
    });
  });

  await reservationLifecycleWorker.stop();
  await closePool();
  logger.info('Graceful shutdown finished');
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
