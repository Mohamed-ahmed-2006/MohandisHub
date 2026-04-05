import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { startReservationLifecycleWorker } from './modules/reservations/reservations.lifecycle-worker.js';
import { startRetentionWorker } from './modules/retention/retention.worker.js';

const reservationWorker = startReservationLifecycleWorker();
const retentionWorker = startRetentionWorker();

logger.info('Reservation lifecycle worker started');
logger.info('Retention worker started');

const shutdown = async (signal: string): Promise<void> => {
  logger.info('Worker shutdown started', { signal });
  await reservationWorker.stop();
  await retentionWorker.stop();
  await closePool();
  logger.info('Worker shutdown finished');
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
