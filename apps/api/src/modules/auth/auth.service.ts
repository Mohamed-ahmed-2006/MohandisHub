// ---------------------------------------------------------------------------
// Auth service — business logic for registration, login, token refresh
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import type {
  AccessTokenPayload,
  AuthMessageResult,
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
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { buildTransactionalEmailHtml } from '../../utils/transactional-email-template.js';
import { PlansService } from '../plans/plans.service.js';
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
const PASSWORD_RESET_TTL_MINUTES = 30;
const MESSAGE_NO_ACCOUNT = 'No account found with this email address.';
const MESSAGE_ACCOUNT_DISABLED = 'This account is disabled. Please contact support.';
const MESSAGE_LINK_SENT =
  'A password reset link has been sent to your email. Check your inbox and spam folder.';
const MESSAGE_SEND_FAILED =
  'We could not send the reset email. Please try again later.';
const MESSAGE_SEND_FAILED_DEV =
  'Email was not sent (email service not configured or failed). Use the link below to reset your password.';

export class AuthService {
  public constructor(
    private readonly authRepository: AuthRepository = new AuthRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly plansService: PlansService = new PlansService(),
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
        message: 'New sign-ups are currently disabled.',
      });
    }

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
      phoneCode: input.phoneCode,
      nationality: input.nationality,
      dateOfBirth: input.dateOfBirth,
      acceptedTermsAt: input.acceptedTermsAt,
      termsVersion: input.termsVersion,
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

  async forgotPassword(input: ForgotPasswordInput): Promise<AuthMessageResult> {
    try {
      const normalizedEmail = input.email.trim().toLowerCase();
      const user = await this.authRepository.findUserByEmail(normalizedEmail);

      if (!user) {
        return { message: MESSAGE_NO_ACCOUNT };
      }
      if (!user.is_active) {
        return { message: MESSAGE_ACCOUNT_DISABLED };
      }

      const rawToken = randomBytes(48).toString('base64url');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

      await this.authRepository.setPasswordResetToken(user.id, tokenHash, expiresAt);

      const resetLink = this.buildPasswordResetLink(rawToken);

      try {
        await this.sendPasswordResetEmail({
          to: user.email,
          displayName: user.display_name,
          resetLink,
        });
        const result: AuthMessageResult = { message: MESSAGE_LINK_SENT };
        if (env.OTP_EMAIL_PROVIDER === 'console') {
          result.devResetLink = resetLink;
        }
        return result;
      } catch (error) {
        logger.error('Failed to send password reset email', {
          userId: user.id,
          email: user.email,
          error: error instanceof Error ? error.message : String(error),
        });
        const result: AuthMessageResult = { message: MESSAGE_SEND_FAILED };
        if (env.NODE_ENV === 'development') {
          result.message = MESSAGE_SEND_FAILED_DEV;
          result.devResetLink = resetLink;
        }
        return result;
      }
    } catch (error) {
      logger.error('Forgot password flow failed', {
        email: input.email?.trim?.()?.toLowerCase?.() ?? '(unknown)',
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      return { message: MESSAGE_SEND_FAILED };
    }
  }

  async resetPassword(input: ResetPasswordInput): Promise<AuthMessageResult> {
    const tokenHash = hashToken(input.token);
    const user = await this.authRepository.findUserByPasswordResetToken(tokenHash);

    if (!user || !user.is_active) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_RESET_TOKEN',
        message: 'Reset token is invalid or expired.',
      });
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    await this.authRepository.updatePasswordHash(user.id, passwordHash);
    await this.authRepository.clearPasswordResetToken(user.id);
    await this.authRepository.revokeAllUserTokens(user.id);

    return {
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
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

    const status = await this.settingsService.getAppStatus();
    if (status.lockLogins && !userRow.is_admin) {
      throw new HttpError({
        statusCode: 503,
        code: 'LOGINS_LOCKED',
        message: 'Logins are temporarily disabled. Please try again later.',
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
    const effectivePlanSlug = await this.plansService.getEffectivePlanSlug(userId);
    return this.toAuthUser(userRow, verificationStatus, effectivePlanSlug);
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
      isAdmin: user.is_admin === true,
      adminPermissions: Array.isArray(user.admin_permissions) ? user.admin_permissions : [],
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

  private buildPasswordResetLink(rawToken: string): string {
    const base =
      env.WEB_PUBLIC_URL ?? env.CORS_ORIGIN ?? env.API_PUBLIC_URL ?? 'https://mohandishub.app';
    const baseStr =
      typeof base === 'string' ? base.trim().replace(/\/$/, '') : 'https://mohandishub.app';
    const baseUrl =
      !baseStr || baseStr === '' || baseStr.startsWith('http')
        ? baseStr || 'https://mohandishub.app'
        : `https://${baseStr}`;
    try {
      return new URL(
        `/auth/reset-password?token=${encodeURIComponent(rawToken)}`,
        baseUrl,
      )
        .toString()
        .trim();
    } catch {
      return `https://mohandishub.app/auth/reset-password?token=${encodeURIComponent(rawToken)}`;
    }
  }

  private async sendPasswordResetEmail(params: {
    to: string;
    displayName: string;
    resetLink: string;
  }): Promise<void> {
    if (env.OTP_EMAIL_PROVIDER === 'console') {
      logger.info('Password reset link generated', {
        to: params.to,
        resetLink: params.resetLink,
      });
      console.log('\n----------------------------------------');
      console.log('  Password reset email (dev)');
      console.log(`  To:   ${params.to}`);
      console.log(`  Link: ${params.resetLink}`);
      console.log('----------------------------------------\n');
      return;
    }

    if (env.OTP_EMAIL_PROVIDER === 'brevo') {
      if (!env.BREVO_API_KEY) {
        throw new Error('Brevo email sender not configured. Set BREVO_API_KEY in .env');
      }

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': env.BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender: { name: 'MohandisHub', email: env.EMAIL_FROM },
          to: [{ email: params.to, name: params.displayName }],
          subject: 'MohandisHub - Reset your password',
          htmlContent: buildTransactionalEmailHtml({
            preheader: 'Reset your MohandisHub password',
            title: 'Reset your password',
            greeting: `Hello ${params.displayName},`,
            introLines: ['We received a request to reset your password.'],
            action: {
              kind: 'button',
              label: 'Reset Password',
              url: params.resetLink,
            },
            expiryText: `This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.`,
            safetyText: 'If you did not request this, you can safely ignore this email.',
            footerText: 'If this was not you, we recommend securing your account immediately.',
          }),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errMsg = `Brevo email send failed: ${response.status} ${errorText}`;
        throw new Error(errMsg);
      }

      return;
    }

    throw new Error('SendGrid email sender not configured. Set SENDGRID_API_KEY in .env');
  }

  private toAuthUser(
    user: UserRow,
    verificationStatus: VerificationStatus | null,
    effectivePlanSlug?: string,
  ): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      phone: user.phone,
      phoneCode: user.phone_code,
      nationality: user.nationality,
      avatarUrl: user.avatar_url,
      dateOfBirth: user.date_of_birth ? user.date_of_birth.toISOString().slice(0, 10) : null,
      role: user.primary_role,
      isAdmin: user.is_admin === true,
      adminPermissions: Array.isArray(user.admin_permissions) ? user.admin_permissions : [],
      plan: effectivePlanSlug ?? user.plan_slug,
      emailVerified: user.email_verified_at !== null,
      verificationStatus,
      createdAt: user.created_at.toISOString(),
    };
  }
}

