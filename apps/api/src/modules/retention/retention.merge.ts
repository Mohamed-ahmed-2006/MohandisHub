import type { RetentionCategoryConfig } from './retention.types.js';

/** Env is the ceiling: effective = min(envHours, adminHours). Null = skip step. */
export function mergeRetentionHours(
  admin: RetentionCategoryConfig | undefined,
  envValue: number,
  envUnit: 'hours' | 'days',
): number | null {
  if (envValue <= 0) return null;
  const envH = envUnit === 'days' ? envValue * 24 : envValue;
  if (!admin) return envH;
  if (!admin.enabled || admin.value <= 0) return null;
  const adminH = admin.unit === 'days' ? admin.value * 24 : admin.value;
  return Math.min(envH, adminH);
}
