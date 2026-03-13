import type { Locale } from './types';

/**
 * Pick the localized string from an API entity that has _en and _ar fields.
 * Use this consistently instead of branching on locale in components.
 */
export function pickLocalized<T extends Record<string, unknown>>(
  entity: T,
  locale: Locale,
  enKey: keyof T,
  arKey: keyof T,
): string {
  const key = locale === 'ar' ? arKey : enKey;
  const value = entity[key];
  return typeof value === 'string' ? value : '';
}
