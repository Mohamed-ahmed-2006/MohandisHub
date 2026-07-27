import { HttpError } from './http-error.js';

const ISO_DATE_OR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;

function invalidDateRange(message: string): never {
  throw new HttpError({ statusCode: 400, code: 'INVALID_DATE_RANGE', message });
}

function parseIso(value: unknown, field: 'from' | 'to'): Date | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !ISO_DATE_OR_TIMESTAMP.test(value)) {
    return invalidDateRange(`${field} must be an ISO-8601 UTC date or timestamp.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return invalidDateRange(`${field} is not a valid date.`);
  return date;
}

export function parseAnalyticsDateRange(
  query: Record<string, unknown>,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const fromInput = parseIso(query.from, 'from');
  const toInput = parseIso(query.to, 'to');
  const daysInput = query.days;
  let days = 30;
  if (daysInput !== undefined) {
    if (typeof daysInput !== 'string' || !/^[1-9]\d*$/.test(daysInput)) {
      return invalidDateRange('days must be a positive base-10 integer.');
    }
    days = Number(daysInput);
    if (!Number.isSafeInteger(days) || days > 366) {
      return invalidDateRange('days cannot exceed 366.');
    }
  }

  const to = toInput ?? new Date(now);
  const from = fromInput ?? new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  if (to.getTime() > now.getTime() + 5 * 60 * 1000) {
    return invalidDateRange('to cannot be in the future.');
  }
  if (from.getTime() > to.getTime()) return invalidDateRange('from must not be after to.');
  if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return invalidDateRange('Analytics ranges cannot exceed 366 days.');
  }
  return { from, to };
}
