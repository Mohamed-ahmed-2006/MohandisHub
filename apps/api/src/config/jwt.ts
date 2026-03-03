// ---------------------------------------------------------------------------
// JWT helpers — sign / verify access & refresh tokens
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import type { AccessTokenPayload } from '@mohandishub/shared';
import jwt from 'jsonwebtoken';

import { env } from './env.js';

// ---- Access Token --------------------------------------------------------

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    algorithm: 'HS256',
  });

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload;

// ---- Refresh Token -------------------------------------------------------

/** Generate a cryptographically-random opaque refresh token. */
export const generateRefreshToken = (): string => randomBytes(48).toString('base64url');

/** Hash a raw refresh token with SHA-256 for safe DB storage. */
export const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/** Get an expiry date for refresh tokens. */
export const getRefreshTokenExpiry = (): Date => {
  const date = new Date();
  date.setDate(date.getDate() + env.JWT_REFRESH_EXPIRES_IN_DAYS);
  return date;
};
