import { logger } from '../../config/logger.js';

import type { RetentionAlertsJson } from './retention.types.js';
import type { SweepResults } from './retention.types.js';

export function sendRetentionAlert(
  alerts: RetentionAlertsJson,
  payload: { type: string; message: string; results?: SweepResults },
): Promise<void> {
  const url = alerts.webhookUrl?.trim();
  if (url) {
    logger.warn('Retention webhook delivery is disabled until destinations can be allowlisted');
  }
  if (alerts.alertEmail?.trim()) {
    logger.info('Retention alert email configured (no mailer wired)', {
      email: alerts.alertEmail,
      type: payload.type,
    });
  }
  return Promise.resolve();
}

export function checkDeleteThresholds(
  alerts: RetentionAlertsJson,
  results: SweepResults,
): string | null {
  const th = alerts.deleteCountThresholds;
  if (!th) return null;
  for (const [key, max] of Object.entries(th)) {
    if (max == null || max <= 0) continue;
    const step = results[key];
    const deleted = (step?.deletedRows ?? 0) + (step?.deletedFiles ?? 0);
    if (deleted > max) {
      return `Category ${key} deleted ${deleted}, threshold ${max}`;
    }
  }
  return null;
}
