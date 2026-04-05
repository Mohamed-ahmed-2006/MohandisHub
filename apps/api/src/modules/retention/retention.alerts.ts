import { logger } from '../../config/logger.js';

import type { RetentionAlertsJson } from './retention.types.js';
import type { SweepResults } from './retention.types.js';

export async function sendRetentionAlert(
  alerts: RetentionAlertsJson,
  payload: { type: string; message: string; results?: SweepResults },
): Promise<void> {
  const url = alerts.webhookUrl?.trim();
  if (url) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'mohandishub-retention',
          ...payload,
        }),
      });
    } catch (e) {
      logger.warn('Retention webhook failed', {
        error: e instanceof Error ? e.message : 'unknown',
      });
    }
  }
  if (alerts.alertEmail?.trim()) {
    logger.info('Retention alert email configured (no mailer wired)', {
      email: alerts.alertEmail,
      type: payload.type,
    });
  }
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
