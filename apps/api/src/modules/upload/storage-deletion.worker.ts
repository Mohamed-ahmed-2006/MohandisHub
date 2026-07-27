import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { captureException } from '../../config/sentry.js';
import { hasDatabaseConfig } from '../../db/pool.js';
import {
  deleteLocalUploadBasenameIfExists,
  deleteLocalUploadRelativePathIfExists,
} from '../../lib/local-upload-storage.js';
import {
  deleteObjectsFromBucket,
  isSupabaseStorageConfigured,
} from '../../lib/supabase-storage.js';

import {
  completeStorageDeletionJob,
  leaseStorageDeletionJobs,
  retryStorageDeletionJob,
  type StorageDeletionJob,
} from './upload.repository.js';

type StorageDeletionWorkerHandle = { stop: () => Promise<void> };

export async function deleteStorageObject(job: StorageDeletionJob): Promise<void> {
  if (job.bucket === 'local-public') {
    deleteLocalUploadBasenameIfExists(job.storage_path);
    return;
  }
  if (job.bucket === 'local') {
    deleteLocalUploadRelativePathIfExists(job.storage_path);
    return;
  }
  if (!isSupabaseStorageConfigured()) {
    throw new Error('Object storage is not configured for a pending deletion');
  }
  await deleteObjectsFromBucket(job.bucket, [job.storage_path]);
}

export const startStorageDeletionWorker = (): StorageDeletionWorkerHandle => {
  if (env.NODE_ENV === 'test' || !hasDatabaseConfig()) {
    return { stop: () => Promise.resolve() };
  }

  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const jobs = await leaseStorageDeletionJobs();
      for (const job of jobs) {
        try {
          await deleteStorageObject(job);
          await completeStorageDeletionJob(job);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown storage deletion error';
          const terminal = await retryStorageDeletionJob(
            job,
            message,
            env.STORAGE_DELETION_MAX_ATTEMPTS,
          );
          if (terminal) {
            captureException(error);
            logger.error('Storage deletion exhausted retries', {
              uploadObjectId: job.upload_object_id,
              attempts: job.attempts,
            });
          }
        }
      }
    } catch (error) {
      captureException(error);
      logger.error('Storage deletion worker failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void run(), env.STORAGE_DELETION_INTERVAL_MS);
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
