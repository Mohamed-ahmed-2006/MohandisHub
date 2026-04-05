import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { hasDatabaseConfig } from '../../db/pool.js';

import { RetentionService } from './retention.service.js';

type RetentionWorkerHandle = {
  stop: () => Promise<void>;
};

export const startRetentionWorker = (): RetentionWorkerHandle => {
  if (env.NODE_ENV === 'test' || !hasDatabaseConfig()) {
    return {
      stop: async () => {
        // no-op
      },
    };
  }

  const service = new RetentionService();
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runSweep = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await service.runSweep({ dryRun: false, trigger: 'worker' });
      if (result && Object.keys(result).length > 0) {
        const anyDeletes = Object.values(result).some(
          (s) => (s?.deletedRows ?? 0) > 0 || (s?.deletedFiles ?? 0) > 0,
        );
        if (anyDeletes) {
          logger.info('Retention sweep completed with deletions', { result });
        }
      }
    } catch (error) {
      logger.error('Retention sweep failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    void runSweep();
  }, env.RETENTION_SWEEP_INTERVAL_MS);
  timer.unref?.();
  void runSweep();

  return {
    stop: (): Promise<void> => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return Promise.resolve();
    },
  };
};
