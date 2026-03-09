import 'express-async-errors';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { walletController } from './modules/wallet/wallet.controller.js';
import { healthRouter } from './routes/health.routes.js';
import { apiRouter } from './routes/index.js';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  const allowedOrigins: string[] = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (env.CORS_EXTRA_ORIGINS) {
    allowedOrigins.push(
      ...env.CORS_EXTRA_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  // Webhooks must receive raw body for signature verification
  app.use(
    '/api/wallet/cryptomus-webhook',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      void walletController.cryptomusWebhook(req, res, next);
    },
  );
  app.use(
    '/api/wallet/stripe-webhook',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      void walletController.stripeWebhook(req, res, next);
    },
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
  app.use('/health', healthRouter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
