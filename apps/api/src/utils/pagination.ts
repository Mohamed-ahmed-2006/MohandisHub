import { HttpError } from './http-error.js';

export type PaginationOptions = {
  defaultLimit: number;
  maxLimit: number;
  defaultPage?: number;
  maxPage?: number;
};

export type ParsedPagination = {
  page: number;
  limit: number;
  offset: number;
};

function parsePositiveInteger(value: unknown, fallback: number, field: 'page' | 'limit'): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_PAGINATION',
      message: `${field} must be a positive base-10 integer.`,
    });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_PAGINATION',
      message: `${field} is outside the supported range.`,
    });
  }
  return parsed;
}

export function parsePagination(
  query: Record<string, unknown>,
  options: PaginationOptions,
): ParsedPagination {
  const defaultPage = options.defaultPage ?? 1;
  const maxPage = options.maxPage ?? 1_000_000;
  const page = parsePositiveInteger(query.page, defaultPage, 'page');
  const limit = parsePositiveInteger(query.limit, options.defaultLimit, 'limit');

  if (page > maxPage || limit > options.maxLimit) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_PAGINATION',
      message: `Pagination exceeds the supported maximum (page ${maxPage}, limit ${options.maxLimit}).`,
    });
  }

  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_PAGINATION',
      message: 'Pagination offset is outside the supported range.',
    });
  }

  return { page, limit, offset };
}

export function parseLimit(
  value: unknown,
  options: Pick<PaginationOptions, 'defaultLimit' | 'maxLimit'>,
): number {
  return parsePagination(
    { page: undefined, limit: value },
    { ...options, defaultPage: 1, maxPage: 1 },
  ).limit;
}
