import { createHash, randomInt } from 'node:crypto';

import type { AuthUser, VerificationStatus } from '@mohandishub/shared';
import { isVerifiableRole } from '@mohandishub/shared';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { AuthRepository } from '../auth/auth.repository.js';
import type { UserRow } from '../auth/auth.types.js';
import { createOtpSender } from '../otp/otp.provider.js';
import { ProfilesRepository } from '../profiles/profiles.repository.js';
import {
  getEffectiveBusinessVerificationStatus,
  getEffectiveCraftsmanVerificationStatus,
  getEffectiveExpertVerificationStatus,
  syncVerificationStatusForRequiredImage,
} from '../profiles/verification-image-requirements.js';

import { UsersRepository } from './users.repository.js';
import type { UserSummary } from './users.types.js';
import type { UpdateAccountInput } from './users.validation.js';

const EMAIL_CHANGE_TTL_MINUTES = 10;

export class UsersService {
  public constructor(
    private readonly usersRepository: UsersRepository = new UsersRepository(),
    private readonly authRepository: AuthRepository = new AuthRepository(),
    private readonly profilesRepository: ProfilesRepository = new ProfilesRepository(),
  ) {}

  public listUsers(): UserSummary[] {
    return this.usersRepository.listUsers();
  }

  public getUserById(id: string): UserSummary {
    const user = this.usersRepository.findById(id);

    if (!user) {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: `User not found for id: ${id}`,
      });
    }

    return user;
  }

  public async updateAccount(userId: string, input: UpdateAccountInput): Promise<AuthUser> {
    const fields: {
      displayName?: string;
      phone?: string | null;
      phoneCode?: string | null;
      nationality?: string | null;
      avatarUrl?: string | null;
      dateOfBirth?: string | null;
    } = {};
    if (input.displayName !== undefined) fields.displayName = input.displayName;
    if (input.phone !== undefined) fields.phone = input.phone;
    if (input.phoneCode !== undefined) fields.phoneCode = input.phoneCode;
    if (input.nationality !== undefined) fields.nationality = input.nationality;
    if (input.avatarUrl !== undefined) fields.avatarUrl = input.avatarUrl;
    if (input.dateOfBirth !== undefined) fields.dateOfBirth = input.dateOfBirth;

    const updated = await this.authRepository.updateUser(userId, fields);

    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    if (
      input.avatarUrl !== undefined &&
      (updated.primary_role === 'expert' || updated.primary_role === 'craftsman')
    ) {
      await syncVerificationStatusForRequiredImage(
        this.profilesRepository,
        userId,
        updated.primary_role,
      );
    }

    const verificationStatus = await this.getVerificationStatus(updated);
    return this.toAuthUser(updated, verificationStatus);
  }

  public async requestEmailChange(
    userId: string,
    newEmail: string,
  ): Promise<{ maskedEmail: string; expiresInSeconds: number }> {
    const existing = await this.authRepository.findUserByEmail(newEmail);
    if (existing) {
      throw new HttpError({
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'This email address is already in use.',
      });
    }

    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    const code = randomInt(100_000, 1_000_000).toString();
    const codeHash = createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MINUTES * 60 * 1000);

    await this.authRepository.setPendingEmail(userId, newEmail, codeHash, expiresAt);

    const sender = createOtpSender('email', env.OTP_EMAIL_PROVIDER, env.OTP_SMS_PROVIDER);
    const sent = await sender.send({
      destination: newEmail,
      code,
      displayName: user.display_name,
    });

    if (!sent) {
      logger.error('Failed to send email-change OTP', { userId, newEmail });
      await this.authRepository.clearPendingEmail(userId);
      throw new HttpError({
        statusCode: 502,
        code: 'OTP_SEND_FAILED',
        message: 'Failed to send the verification code. Please try again.',
      });
    }

    const [local, domain] = newEmail.split('@');
    const masked =
      local && domain
        ? local.length <= 2
          ? `${local[0]}***@${domain}`
          : `${local[0]}***${local[local.length - 1]}@${domain}`
        : '***@***';

    return { maskedEmail: masked, expiresInSeconds: EMAIL_CHANGE_TTL_MINUTES * 60 };
  }

  public async confirmEmailChange(userId: string, code: string): Promise<AuthUser> {
    const pending = await this.authRepository.getPendingEmail(userId);
    if (!pending) {
      throw new HttpError({
        statusCode: 400,
        code: 'NO_PENDING_EMAIL',
        message: 'No pending email change found or it has expired.',
      });
    }

    const inputHash = createHash('sha256').update(code.trim()).digest('hex');
    if (inputHash !== pending.pending_email_token) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_CODE',
        message: 'Incorrect verification code.',
      });
    }

    const emailTaken = await this.authRepository.findUserByEmail(pending.pending_email);
    if (emailTaken) {
      await this.authRepository.clearPendingEmail(userId);
      throw new HttpError({
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'This email address was taken while the change was pending.',
      });
    }

    const updated = await this.authRepository.confirmEmailChange(userId);
    if (!updated) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    const verificationStatus = await this.getVerificationStatus(updated);
    return this.toAuthUser(updated, verificationStatus);
  }

  private async getVerificationStatus(user: UserRow): Promise<VerificationStatus | null> {
    if (!isVerifiableRole(user.primary_role)) return null;
    if (user.primary_role === 'expert') {
      const profile = await this.authRepository.getExpertVerification(user.id);
      if (!profile) return 'unverified';
      return getEffectiveExpertVerificationStatus(profile, Boolean(user.avatar_url?.trim()));
    }
    if (user.primary_role === 'business') {
      const [profile, logoUrl] = await Promise.all([
        this.authRepository.getBusinessVerification(user.id),
        this.profilesRepository.getBusinessLogoUrl(user.id),
      ]);
      if (!profile) return 'unverified';
      return getEffectiveBusinessVerificationStatus(profile, Boolean(logoUrl?.trim()));
    }
    if (user.primary_role === 'craftsman') {
      const profile = await this.authRepository.getCraftsmanVerification(user.id);
      if (!profile) return 'unverified';
      return getEffectiveCraftsmanVerificationStatus(profile, Boolean(user.avatar_url?.trim()));
    }
    return null;
  }

  private toAuthUser(user: UserRow, verificationStatus: VerificationStatus | null): AuthUser {
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
      plan: user.plan_slug,
      emailVerified: user.email_verified_at !== null,
      verificationStatus,
      createdAt: user.created_at.toISOString(),
    };
  }
}
