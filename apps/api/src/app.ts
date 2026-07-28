import 'express-async-errors';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { getAllowedCorsOrigins, isCorsOriginAllowed } from './config/cors.js';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { publicUploadsHandler } from './middleware/public-uploads.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLoggingMiddleware } from './middleware/request-logging.js';
import { mhcController } from './modules/mhc/mhc.controller.js';
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
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        reportOnly: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'http:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'http:', 'https:', 'ws:', 'wss:'],
          frameSrc: ["'self'", 'https:'],
          formAction: ["'self'"],
        },
      },
    }),
  );
  app.use(requestIdMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(compression());
  const allowedOrigins = getAllowedCorsOrigins();
  app.use(
    cors({
      origin: (origin, cb) => {
        if (isCorsOriginAllowed(origin, allowedOrigins)) return cb(null, true);
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
  // MHC credit purchases have their own IPN endpoint so credit fulfilment never
  // shares a code path with legacy EGP wallet deposits.
  app.use(
    '/api/credits/nowpayments/ipn',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      void mhcController.nowPaymentsIpn(req, res, next);
    },
  );
  app.use(
    '/api/wallet/paymob/webhook',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
      void walletController.paymobDepositWebhook(req, res, next);
    },
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/uploads/private', (_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
  // Local disk and/or Supabase `uploads` bucket (see middleware/public-uploads.ts).
  app.get('/uploads/:filename', publicUploadsHandler);
  app.use('/health', healthRouter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
