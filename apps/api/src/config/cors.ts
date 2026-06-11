import { env } from './env.js';

const splitOrigins = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export const getAllowedCorsOrigins = (): string[] => {
  const allowedOrigins = [
    ...splitOrigins(env.CORS_ORIGIN),
    ...splitOrigins(env.CORS_EXTRA_ORIGINS),
  ];

  // Allow local dev origins automatically only outside production. Production can still opt in
  // temporarily through CORS_EXTRA_ORIGINS, but credentialed localhost CORS must not be a default.
  if (env.NODE_ENV !== 'production') {
    allowedOrigins.push(
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    );
  }

  return Array.from(new Set(allowedOrigins));
};

export const isCorsOriginAllowed = (
  origin: string | undefined,
  allowedOrigins = getAllowedCorsOrigins(),
): boolean => !origin || allowedOrigins.includes(origin);
