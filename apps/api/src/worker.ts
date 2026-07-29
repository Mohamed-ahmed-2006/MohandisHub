import { logger } from './config/logger.js';
import { captureException, initSentry } from './config/sentry.js';
import { closePool } from './db/pool.js';
import { startAwardExpiryWorker } from './modules/mhc/award-expiry.worker.js';
import { startReservationLifecycleWorker } from './modules/reservations/reservations.lifecycle-worker.js';
import { startRetentionWorker } from './modules/retention/retention.worker.js';

initSentry();

const reservationWorker = startReservationLifecycleWorker();
const retentionWorker = startRetentionWorker();
const awardExpiryWorker = startAwardExpiryWorker();

logger.info('Reservation lifecycle worker started');
logger.info('Retention worker started');
logger.info('Award expiry worker started');
logger.info('Worker ready', { pid: process.pid });

const heartbeat = setInterval(() => {
  logger.info('Worker heartbeat', {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
}, 60_000);
heartbeat.unref?.();

const shutdown = async (signal: string): Promise<void> => {
  logger.info('Worker shutdown started', { signal });
  clearInterval(heartbeat);
  await reservationWorker.stop();
  await retentionWorker.stop();
  await awardExpiryWorker.stop();
  await closePool();
  logger.info('Worker shutdown finished');
  process.exit(0);
};

process.on('uncaughtException', (error) => {
  captureException(error);
  logger.error('Worker uncaught exception', { error: error.message });
  void shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  captureException(reason);
  logger.error('Worker unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
  void shutdown('unhandledRejection');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
