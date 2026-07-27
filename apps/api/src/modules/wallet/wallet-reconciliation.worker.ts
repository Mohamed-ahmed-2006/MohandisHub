import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { captureException } from '../../config/sentry.js';
import { hasDatabaseConfig } from '../../db/pool.js';

import { WalletService } from './wallet.service.js';

type ReconciliationWorkerHandle = { stop: () => Promise<void> };

export const startWalletReconciliationWorker = (): ReconciliationWorkerHandle => {
  if (env.NODE_ENV === 'test' || !hasDatabaseConfig()) {
    return { stop: () => Promise.resolve() };
  }

  const service = new WalletService();
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const credited = await service.reconcilePendingFxDeposits();
      if (credited > 0) logger.info('Pending FX deposits reconciled', { credited });
      const stale = await service.markStaleDepositIntentsForReconciliation();
      if (stale > 0) logger.info('Stale deposit intents require reconciliation', { stale });
    } catch (error) {
      captureException(error);
      logger.error('Payment reconciliation worker failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void run(), env.PAYMENT_RECONCILIATION_INTERVAL_MS);
  timer.unref?.();
  void run();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      return Promise.resolve();
    },
  };
};
