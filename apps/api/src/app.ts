import 'express-async-errors';
import path from 'node:path';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLoggingMiddleware } from './middleware/request-logging.js';
import { walletController } from './modules/wallet/wallet.controller.js';
import { healthRouter } from './routes/health.routes.js';
import { apiRouter } from './routes/index.js';

export const createApp = () => {
  const app = express();

  // So express-rate-limit (and req.ip) see the caller behind a single reverse-proxy hop.
  if (env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(compression());
  const allowedOrigins: string[] = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  // Allow local dev origins even when API is running in prod/staging.
  // This is required for admin/KYC previews that fetch private uploads with `Authorization` headers.
  const localDevOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];
  if (env.CORS_EXTRA_ORIGINS) {
    allowedOrigins.push(
      ...env.CORS_EXTRA_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }
  allowedOrigins.push(...localDevOrigins);
  const uniqueAllowedOrigins = Array.from(new Set(allowedOrigins));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || uniqueAllowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  // Webhooks must receive raw body for signature verification
  app.use(
    '/api/wallet/nowpayments/ipn',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      void walletController.nowPaymentsIpn(req, res, next);
    },
  );
  app.use(
    '/api/wallet/nowpayments/ipn/deposit',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      void walletController.nowPaymentsDepositIpn(req, res, next);
    },
  );
  app.use(
    '/api/wallet/nowpayments/ipn/payout',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      void walletController.nowPaymentsPayoutIpn(req, res, next);
    },
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/uploads/private', (_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
  app.use('/health', healthRouter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
