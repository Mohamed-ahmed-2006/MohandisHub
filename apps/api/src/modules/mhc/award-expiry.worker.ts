import { logger } from '../../config/logger.js';
import { hasDatabaseConfig } from '../../db/pool.js';

import { MhcService } from './mhc.service.js';

// ---------------------------------------------------------------------------
// Award-offer expiry sweep.
// ---------------------------------------------------------------------------
// `pending_award_expires_at`, its index, and the sweep query all existed, but
// nothing ever ran them — an ignored offer sat pending forever. Decision D4
// requires offers to lapse, so this is the process that makes the timestamp mean
// something.
//
// Releasing is race-safe in the repository: it locks the need and verifies the
// pending award is still the one it is releasing. A provider who activates a
// moment before the sweep keeps their job.
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 50;

export type AwardExpiryWorker = { stop: () => Promise<void> };

export function startAwardExpiryWorker(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): AwardExpiryWorker {
  const service = new MhcService();
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    // Overlapping sweeps would race each other for the same rows. The locked
    // release makes that safe, but doing the work twice is pointless.
    if (running || stopped || !hasDatabaseConfig()) return;
    running = true;
    try {
      const result = await service.expirePendingAwards(BATCH_SIZE);
      if (result.released > 0) {
        logger.info('Award offers expired', {
          examined: result.examined,
          released: result.released,
        });
      }
    } catch (error) {
      logger.error('Award expiry sweep failed', {
        error: error instanceof Error ? error.message : String(error),
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
      // Let an in-flight sweep finish so it is never cut off mid-release.
      while (running) await new Promise((resolve) => setTimeout(resolve, 25));
    },
  };
}
