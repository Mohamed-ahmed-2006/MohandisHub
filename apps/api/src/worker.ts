import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { startReservationLifecycleWorker } from './modules/reservations/reservations.lifecycle-worker.js';

const worker = startReservationLifecycleWorker();

logger.info('Reservation lifecycle worker started');

const shutdown = async (signal: string): Promise<void> => {
  logger.info('Reservation lifecycle worker shutdown started', { signal });
  await worker.stop();
  await closePool();
  logger.info('Reservation lifecycle worker shutdown finished');
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
