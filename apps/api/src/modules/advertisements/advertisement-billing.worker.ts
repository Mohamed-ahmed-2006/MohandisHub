import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { captureException } from '../../config/sentry.js';
import { hasDatabaseConfig } from '../../db/pool.js';

import { AdvertisementRenewalService } from './advertisement-renewal.service.js';

// ---------------------------------------------------------------------------
// Advertisement billing lifecycle worker.
// ---------------------------------------------------------------------------
// The process that makes a 168-hour week actually end and the next one actually
// begin. It owns no correctness of its own — every guarantee lives in the
// database (row locks, unique indexes, the boundary event log). What this file
// owns is CADENCE, BOUNDEDNESS and SHUTDOWN:
//
//   * cadence: one tick per AD_BILLING_SWEEP_INTERVAL_MS, default 60s against a
//     168-hour period. A late tick is harmless — a renewal buys a full week
//     from the instant it charges, not from the instant it was due;
//   * boundedness: each stage examines at most AD_BILLING_SWEEP_BATCH_SIZE
//     campaigns, each in its own transaction. A backlog drains over several
//     ticks instead of one tick holding connections for minutes;
//   * shutdown: `stop()` sets a flag the sweep checks BETWEEN campaigns, then
//     waits for the campaign in flight. A campaign is therefore never cut in
//     half — it has either committed its charge and its week, or neither.
//
// The `running` flag is an efficiency guard, NOT a lock. Two ticks that
// overlapped, two workers on one host, or ten hosts all sweeping at once are
// all safe: they compete for the same rows with `FOR UPDATE SKIP LOCKED`, and
// the loser does nothing rather than doing it twice. Correctness never depends
// on this process being the only one.
// ---------------------------------------------------------------------------

export type AdvertisementBillingWorker = { stop: () => Promise<void> };

export const startAdvertisementBillingWorker = (
  overrides: {
    intervalMs?: number;
    batchSize?: number;
    reminderWindowHours?: number;
    service?: AdvertisementRenewalService;
  } = {},
): AdvertisementBillingWorker => {
  // Same posture as every other worker in this repository: a test process and a
  // process with no database configured start nothing at all, so importing this
  // module can never begin charging anybody.
  if (env.NODE_ENV === 'test' || !hasDatabaseConfig()) {
    return { stop: async () => {} };
  }

  const service = overrides.service ?? new AdvertisementRenewalService();
  const intervalMs = overrides.intervalMs ?? env.AD_BILLING_SWEEP_INTERVAL_MS;
  const batchSize = overrides.batchSize ?? env.AD_BILLING_SWEEP_BATCH_SIZE;
  const reminderWindowHours = overrides.reminderWindowHours ?? env.AD_RENEWAL_REMINDER_HOURS;

  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await service.runLifecycleSweep({
        batchSize,
        reminderWindowHours,
        // Re-read on every campaign, so a SIGTERM during a 25-campaign batch
        // ends the batch after the campaign in flight rather than after all 25.
        shouldStop: () => stopped,
      });
      const didSomething =
        result.started > 0 ||
        result.renewed > 0 ||
        result.paused > 0 ||
        result.expiredPeriods > 0 ||
        result.reminded > 0 ||
        result.notified > 0 ||
        result.failures > 0;
      if (didSomething) {
        logger.info('Advertisement billing sweep processed due items', result);
      }
    } catch (error) {
      // The sweep already isolates per-campaign failures; reaching here means
      // something structural. Report it and let the next tick try again —
      // never crash the worker process, which also runs unrelated sweeps.
      captureException(error);
      logger.error('Advertisement billing sweep failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      clearInterval(timer);
      // Let the campaign in flight finish. Killing it mid-transaction would be
      // safe — an uncommitted charge is no charge — but it would also leave a
      // connection to be reaped, and there is nothing to gain by not waiting.
      while (running) await new Promise((resolve) => setTimeout(resolve, 25));
    },
  };
};
