import { createServer } from 'node:http';

import { Server as SocketServer } from 'socket.io';

import { createApp } from './app.js';
import { getAllowedCorsOrigins, isCorsOriginAllowed } from './config/cors.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { initSentry } from './config/sentry.js';
import { closePool } from './db/pool.js';
import { registerChatSocket } from './modules/chat/chat.socket.js';

initSentry();

const app = createApp();
const httpServer = createServer(app);
const allowedSocketOrigins = getAllowedCorsOrigins();

const io = new SocketServer(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (isCorsOriginAllowed(origin, allowedSocketOrigins)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

registerChatSocket(io);

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
