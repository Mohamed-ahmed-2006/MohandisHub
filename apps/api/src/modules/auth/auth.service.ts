// ---------------------------------------------------------------------------
// Auth service — business logic for registration, login, token refresh
// ---------------------------------------------------------------------------

import type {
  AccessTokenPayload,
  AuthTokens,
  AuthUser,
  VerificationStatus,
} from '@mohandishub/shared';
import { isVerifiableRole } from '@mohandishub/shared';
import bcrypt from 'bcryptjs';

import { env } from '../../config/env.js';
import {
  generateRefreshToken,
  getRefreshTokenExpiry,
  hashToken,
  signAccessToken,
} from '../../config/jwt.js';
import { HttpError } from '../../utils/http-error.js';

import { AuthRepository } from './auth.repository.js';
import type { UserRow } from './auth.types.js';
import type { LoginInput, RegisterInput } from './auth.validation.js';

const SALT_ROUNDS = 12;

export class AuthService {
  public constructor(private readonly authRepository: AuthRepository = new AuthRepository()) {}

  // ── Register ──────────────────────────────────────────────────────────

  async register(
    input: RegisterInput,
    meta?: { deviceInfo?: string | undefined; ipAddress?: string | undefined },
  ): Promise<{ user: AuthUser; tokens: AuthTokens; refreshToken: string }> {
    // Check duplicate email
    const existing = await this.authRepository.findUserByEmail(input.email);
    if (existing) {
      throw new HttpError({
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email address already exists.',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    // Create user row
    const userRow = await this.authRepository.createUser({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      role: input.role,
      phone: input.phone,
      dateOfBirth: input.dateOfBirth,
    });

    // Create role-specific profile
    switch (input.role) {
      case 'customer':
        await this.authRepository.createCustomerProfile(userRow.id);
        break;
      case 'expert':
        await this.authRepository.createExpertProfile(userRow.id);
        break;
      case 'business':
        await this.authRepository.createBusinessProfile(userRow.id);
        break;
    }

    // Build tokens
    const verificationStatus = await this.getVerificationStatus(userRow);
    const { tokens, rawRefreshToken } = await this.issueTokens(userRow, verificationStatus, meta);
    const authUser = this.toAuthUser(userRow, verificationStatus);

    return { user: authUser, tokens, refreshToken: rawRefreshToken };
  }

  // ── Login ─────────────────────────────────────────────────────────────

  async login(
    input: LoginInput,
    meta?: { deviceInfo?: string | undefined; ipAddress?: string | undefined },
  ): Promise<{ user: AuthUser; tokens: AuthTokens; refreshToken: string }> {
    const userRow = await this.authRepository.findUserByEmail(input.email);

    if (!userRow) {
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    if (!userRow.is_active) {
      throw new HttpError({
        statusCode: 403,
        code: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled. Please contact support.',
      });
    }

    const passwordMatch = await bcrypt.compare(input.password, userRow.password_hash);
    if (!passwordMatch) {
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    const verificationStatus = await this.getVerificationStatus(userRow);
    const { tokens, rawRefreshToken } = await this.issueTokens(userRow, verificationStatus, meta);
    const authUser = this.toAuthUser(userRow, verificationStatus);

    return { user: authUser, tokens, refreshToken: rawRefreshToken };
  }

  // ── Refresh ───────────────────────────────────────────────────────────

  async refresh(
    rawRefreshToken: string,
    meta?: { deviceInfo?: string | undefined; ipAddress?: string | undefined },
  ): Promise<{ user: AuthUser; tokens: AuthTokens; newRefreshToken: string }> {
    const tokenHash = hashToken(rawRefreshToken);
    const storedToken = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (!storedToken) {
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired.',
      });
    }

    // Token rotation: revoke the old one
    await this.authRepository.revokeRefreshToken(storedToken.id);

    const userRow = await this.authRepository.findUserById(storedToken.user_id);
    if (!userRow || !userRow.is_active) {
      // If user was deleted or disabled, revoke the entire family
      await this.authRepository.revokeTokenFamily(storedToken.family_id);
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired.',
      });
    }

    // Issue new token pair (same family for reuse detection)
    const verificationStatus = await this.getVerificationStatus(userRow);
    const newRaw = generateRefreshToken();
    const newHash = hashToken(newRaw);

    await this.authRepository.createRefreshToken({
      userId: userRow.id,
      tokenHash: newHash,
      familyId: storedToken.family_id, // keep same family
      deviceInfo: meta?.deviceInfo,
      ipAddress: meta?.ipAddress,
      expiresAt: getRefreshTokenExpiry(),
    });

    const accessPayload = this.buildAccessPayload(userRow, verificationStatus);
    const accessToken = signAccessToken(accessPayload);
    const authUser = this.toAuthUser(userRow, verificationStatus);

    return {
      user: authUser,
      tokens: { accessToken, expiresIn: env.JWT_ACCESS_EXPIRES_IN },
      newRefreshToken: newRaw,
    };
  }

  // ── Logout ────────────────────────────────────────────────────────────

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    const storedToken = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (storedToken) {
      await this.authRepository.revokeTokenFamily(storedToken.family_id);
    }
    // Silently succeed even if token not found (idempotent)
  }

  // ── Get current user (for GET /me) ────────────────────────────────────

  async getMe(userId: string): Promise<AuthUser> {
    const userRow = await this.authRepository.findUserById(userId);

    if (!userRow) {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    const verificationStatus = await this.getVerificationStatus(userRow);
    return this.toAuthUser(userRow, verificationStatus);
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async getVerificationStatus(user: UserRow): Promise<VerificationStatus | null> {
    if (!isVerifiableRole(user.primary_role)) return null;

    if (user.primary_role === 'expert') {
      const profile = await this.authRepository.getExpertVerification(user.id);
      return profile?.verification_status ?? 'unverified';
    }

    if (user.primary_role === 'business') {
      const profile = await this.authRepository.getBusinessVerification(user.id);
      return profile?.verification_status ?? 'unverified';
    }

    return null;
  }

  private buildAccessPayload(
    user: UserRow,
    verificationStatus: VerificationStatus | null,
  ): AccessTokenPayload {
    return {
      sub: user.id,
      role: user.primary_role,
      verified: verificationStatus === 'verified',
      emailVerified: user.email_verified_at !== null,
    };
  }

  private async issueTokens(
    user: UserRow,
    verificationStatus: VerificationStatus | null,
    meta?: { deviceInfo?: string | undefined; ipAddress?: string | undefined },
  ): Promise<{ tokens: AuthTokens; rawRefreshToken: string }> {
    // Access token
    const accessPayload = this.buildAccessPayload(user, verificationStatus);
    const accessToken = signAccessToken(accessPayload);

    // Refresh token
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);

    await this.authRepository.createRefreshToken({
      userId: user.id,
      tokenHash,
      deviceInfo: meta?.deviceInfo,
      ipAddress: meta?.ipAddress,
      expiresAt: getRefreshTokenExpiry(),
    });

    return {
      tokens: { accessToken, expiresIn: env.JWT_ACCESS_EXPIRES_IN },
      rawRefreshToken,
    };
  }

  private toAuthUser(user: UserRow, verificationStatus: VerificationStatus | null): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      dateOfBirth: user.date_of_birth ? user.date_of_birth.toISOString().slice(0, 10) : null,
      role: user.primary_role,
      emailVerified: user.email_verified_at !== null,
      verificationStatus,
      createdAt: user.created_at.toISOString(),
    };
  }
}
