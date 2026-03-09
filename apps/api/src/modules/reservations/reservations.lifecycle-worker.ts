import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { hasDatabaseConfig } from '../../db/pool.js';

import { ReservationsService } from './reservations.service.js';

const SWEEP_INTERVAL_MS = 60_000;

type ReservationLifecycleWorkerHandle = {
  stop: () => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

export const startReservationLifecycleWorker = (): ReservationLifecycleWorkerHandle => {
  if (env.NODE_ENV === 'test' || !hasDatabaseConfig()) {
    return {
      stop: async () => {
        // no-op in test/no-db mode
      },
    };
  }

  const service = new ReservationsService();
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runSweep = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await service.runLifecycleSweep();
      if (result.disconnectReleased > 0 || result.donePrompted > 0) {
        logger.info('Reservation lifecycle sweep processed due items', result);
      }
    } catch (error) {
      logger.error('Reservation lifecycle sweep failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    void runSweep();
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  void runSweep();

  return {
    stop: async () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      while (running) {
        await sleep(25);
      }
    },
  };
};
