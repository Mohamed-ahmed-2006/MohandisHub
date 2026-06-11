// ---------------------------------------------------------------------------
// Auth service — business logic for registration, login, token refresh
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import type {
  AccessTokenPayload,
  AuthTokens,
  AuthUser,
  VerificationStatus,
} from '@mohandishub/shared';
import { isVerifiableRole, normalizeAdminPermissions } from '@mohandishub/shared';
import bcrypt from 'bcryptjs';

import { env } from '../../config/env.js';
import {
  generateRefreshToken,
  getRefreshTokenExpiry,
  hashToken,
  signAccessToken,
} from '../../config/jwt.js';
import { HttpError } from '../../utils/http-error.js';
import { buildTransactionalEmailHtml } from '../../utils/transactional-email-template.js';
import { SettingsService } from '../settings/settings.service.js';

import { AuthRepository } from './auth.repository.js';
import type { UserRow } from './auth.types.js';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.validation.js';

const SALT_ROUNDS = 12;

function planLimitBool(limits: unknown, key: string): boolean {
  if (limits == null || typeof limits !== 'object' || Array.isArray(limits)) return false;
  const v = (limits as Record<string, unknown>)[key];
  return v === true || v === 'true';
}

export class AuthService {
  public constructor(
    private readonly authRepository: AuthRepository = new AuthRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
  ) {}

  // ── Register ──────────────────────────────────────────────────────────

  async register(
    input: RegisterInput,
    meta?: { deviceInfo?: string | undefined; ipAddress?: string | undefined },
  ): Promise<{ user: AuthUser; tokens: AuthTokens; refreshToken: string }> {
    const status = await this.settingsService.getAppStatus();
    if (status.signupsLocked) {
      throw new HttpError({
        statusCode: 403,
        code: 'SIGNUPS_LOCKED',
        message: 'New registrations are temporarily disabled.',
      });
    }

    const existing = await this.authRepository.findUserByEmail(input.email);
    if (existing) {
      const abandoned = await this.authRepository.isAbandonedUnverifiedBusinessSignup(existing.id);
      if (abandoned) {
        await this.authRepository.hardDeleteUserById(existing.id);
      } else {
        throw new HttpError({
          statusCode: 409,
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'An account with this email address already exists.',
        });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    // Create user row
    let userRow: UserRow;
    try {
      userRow = await this.authRepository.createUser({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        role: input.role,
        phone: input.phone,
        phoneCode: input.phoneCode,
        nationality: input.nationality,
        dateOfBirth: input.dateOfBirth,
        acceptedTermsAt: input.acceptedTermsAt,
        termsVersion: input.termsVersion,
      });
    } catch (error: unknown) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === '23505') {
        throw new HttpError({
          statusCode: 409,
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'An account with this email address already exists.',
        });
      }
      if (pgError.code === '22001') {
        throw new HttpError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'A field value is too long for the database.',
        });
      }
      if (pgError.code === '23514' && pgError.constraint === 'chk_users_min_age') {
        throw new HttpError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Date of birth does not meet the minimum age requirement.',
        });
      }
      throw error;
    }

    // Create role-specific profile
    switch (input.role) {
      case 'customer':
        await this.authRepository.createCustomerProfile(userRow.id);
        break;
      case 'expert':
        await this.authRepository.createExpertProfile(userRow.id);
        break;
      case 'craftsman':
        await this.authRepository.createCraftsmanProfile(userRow.id);
        break;
      case 'business':
        await this.authRepository.createBusinessProfile(
          userRow.id,
          input.companyName ?? 'Unnamed Company',
        );
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

    const status = await this.settingsService.getAppStatus();
    if (status.lockLogins && !this.isSuperAdmin(userRow)) {
      throw new HttpError({
        statusCode: 403,
        code: 'LOGINS_LOCKED',
        message: 'Logins are temporarily disabled.',
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

    await this.authRepository.updateLastLoginAt(userRow.id);

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
    const storedToken = await this.authRepository.findAnyRefreshTokenByHash(tokenHash);

    if (!storedToken) {
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired.',
      });
    }

    // Reuse detection: a token that exists but is already revoked (or expired)
    // means someone replayed a rotated token. Revoke the entire family so a
    // stolen token cannot keep minting access tokens.
    if (storedToken.revoked_at !== null || storedToken.expires_at.getTime() <= Date.now()) {
      await this.authRepository.revokeTokenFamily(storedToken.family_id);
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired.',
      });
    }

    // Token rotation: atomically revoke the old one. If the conditional update
    // affects zero rows, a concurrent request already rotated this token, so we
    // treat it as reuse and revoke the family rather than minting a duplicate.
    const rotated = await this.authRepository.revokeRefreshTokenIfActive(storedToken.id);
    if (!rotated) {
      await this.authRepository.revokeTokenFamily(storedToken.family_id);
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired.',
      });
    }

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

  async forgotPassword(
    input: ForgotPasswordInput,
  ): Promise<{ message: string; devResetLink?: string }> {
    const generic = {
      message: 'If your email is registered, a password reset link has been sent.',
    };
    const userRow = await this.authRepository.findUserByEmail(input.email);
    if (!userRow) {
      return generic;
    }
    if (!userRow.is_active) {
      return generic;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await this.authRepository.setPasswordResetToken(userRow.id, tokenHash, expiresAt);

    const webBase = (env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const resetUrl = `${webBase}/en/auth/reset-password#token=${encodeURIComponent(rawToken)}`;

    const emailSent = await this.sendPasswordResetEmail(
      userRow.email,
      userRow.display_name,
      resetUrl,
    );
    if (!emailSent) {
      return {
        message:
          'We could not send a password reset email right now. Please try again later or contact support.',
      };
    }

    return {
      message: 'If your email is registered, a password reset link has been sent.',
      // Only ever expose the raw reset link outside production, and only when the
      // console email provider is in use (local dev without real email delivery).
      ...(env.NODE_ENV !== 'production' && env.OTP_EMAIL_PROVIDER === 'console'
        ? { devResetLink: resetUrl }
        : {}),
    };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const tokenHash = hashToken(input.token);
    const userRow = await this.authRepository.findUserByPasswordResetToken(tokenHash);
    if (!userRow) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_RESET_TOKEN',
        message: 'Invalid or expired password reset token.',
      });
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    await this.authRepository.updatePasswordHash(userRow.id, passwordHash);
    await this.authRepository.clearPasswordResetToken(userRow.id);
    await this.authRepository.revokeAllUserTokens(userRow.id);

    return { message: 'Password has been reset successfully. You can now sign in.' };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async sendPasswordResetEmail(
    to: string,
    displayName: string,
    resetUrl: string,
  ): Promise<boolean> {
    if (env.OTP_EMAIL_PROVIDER === 'console') {
      console.log('\n----------------------------------------');
      console.log('  Password reset (dev)');
      console.log(`  To:   ${to}`);
      console.log(`  Link: ${resetUrl}`);
      console.log('----------------------------------------\n');
      return true;
    }

    if (env.OTP_EMAIL_PROVIDER === 'brevo') {
      if (!env.BREVO_API_KEY) {
        return false;
      }
      const htmlContent = buildTransactionalEmailHtml({
        preheader: 'Reset your MohandisHub password',
        title: 'Reset your password',
        greeting: `Hello ${displayName},`,
        introLines: [
          'We received a request to reset your password. Use the button below to choose a new password.',
        ],
        action: { kind: 'button', label: 'Reset Password', url: resetUrl },
        safetyText: 'If you did not request this, you can safely ignore this email.',
      });
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': env.BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender: { name: 'MohandisHub', email: env.EMAIL_FROM },
          to: [{ email: to, name: displayName }],
          subject: 'MohandisHub - Reset your password',
          htmlContent,
        }),
      });
      return response.ok;
    }

    if (env.OTP_EMAIL_PROVIDER === 'sendgrid') {
      return false;
    }

    return false;
  }

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

    if (user.primary_role === 'craftsman') {
      const profile = await this.authRepository.getCraftsmanVerification(user.id);
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
      isAdmin: user.is_admin === true,
    };
  }

  private isSuperAdmin(user: UserRow): boolean {
    return (
      user.is_admin === true &&
      Array.isArray(user.admin_permissions) &&
      user.admin_permissions.includes('super_admin')
    );
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
    const adminPermissions = normalizeAdminPermissions(user.admin_permissions);
    const role = user.primary_role;
    const pl = user.plan_limits;
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      phone: user.phone,
      phoneCode: user.phone_code,
      nationality: user.nationality,
      avatarUrl: user.avatar_url,
      dateOfBirth: user.date_of_birth ? user.date_of_birth.toISOString().slice(0, 10) : null,
      role,
      isAdmin: user.is_admin === true,
      adminPermissions,
      plan: user.plan_slug,
      planProBadge: (role === 'expert' || role === 'craftsman') && planLimitBool(pl, 'canProBadge'),
      planTrustedBusinessBadge: role === 'business' && planLimitBool(pl, 'canTrustedBusinessBadge'),
      emailVerified: user.email_verified_at !== null,
      verificationStatus,
      createdAt: user.created_at.toISOString(),
    };
  }
}
