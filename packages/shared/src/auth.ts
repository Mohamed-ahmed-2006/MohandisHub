// ---------------------------------------------------------------------------
// Auth-related shared types — DTOs exchanged between API and frontend
// ---------------------------------------------------------------------------

import type { UserRole } from './roles.js';
import type { VerificationStatus } from './verification.js';

/** Payload sent when registering a new user. */
export type RegisterBody = {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  phone?: string;
  dateOfBirth: string; // ISO date string 'YYYY-MM-DD'
};

/** Payload sent when logging in. */
export type LoginBody = {
  email: string;
  password: string;
};

/** JWT access-token payload (decoded). */
export type AccessTokenPayload = {
  sub: string; // user id
  role: UserRole;
  verified: boolean;
  emailVerified: boolean;
};

/** Returned after successful login or register. */
export type AuthTokens = {
  accessToken: string;
  expiresIn: number; // seconds
};

/** User info returned by GET /api/auth/me. */
export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  role: UserRole;
  emailVerified: boolean;
  verificationStatus: VerificationStatus | null; // null for customers
  createdAt: string;
};
