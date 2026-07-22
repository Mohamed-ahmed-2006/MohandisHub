import { describe, expect, it, vi } from 'vitest';

import { ProfilesService } from '../modules/profiles/profiles.service.js';

const makeService = (repo: Record<string, unknown>, settings: Record<string, unknown> = {}) =>
  new ProfilesService(
    repo as never,
    settings as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('profile verification document integrity', () => {
  it('rejects academic evidence that is not a private upload owned by the user', async () => {
    const repo = {
      privateUploadBelongsToUser: vi.fn().mockResolvedValue(false),
      createAcademicRecord: vi.fn(),
    };
    const service = makeService(repo, {
      getAppStatus: vi.fn().mockResolvedValue({ pauseVerificationSubmissions: false }),
    });

    await expect(
      service.submitAcademicRecord('user-1', {
        recordType: 'degree',
        title: 'Engineering',
        institution: 'University',
        certificateImageUrl: '/api/upload/private/11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PRIVATE_UPLOAD' });
    expect(repo.createAcademicRecord).not.toHaveBeenCalled();
  });

  it('does not let an owner replace evidence on an approved academic record', async () => {
    const repo = {
      privateUploadBelongsToUser: vi.fn().mockResolvedValue(true),
      updateAcademicRecord: vi.fn().mockResolvedValue(null),
      findAcademicRecordById: vi.fn().mockResolvedValue({
        id: 'record-1',
        user_id: 'user-1',
        status: 'approved',
      }),
    };
    const service = makeService(repo);

    await expect(
      service.updateAcademicRecord('user-1', 'record-1', {
        certificateImageUrl: '/api/upload/private/22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPROVED_ACADEMIC_RECORD_IMMUTABLE',
    });
  });

  it('rejects identity evidence that is not a private upload owned by the user', async () => {
    const repo = {
      privateUploadBelongsToUser: vi.fn().mockResolvedValue(false),
      createIdentityDocument: vi.fn(),
    };
    const service = makeService(repo, {
      getAppStatus: vi.fn().mockResolvedValue({ pauseVerificationSubmissions: false }),
    });

    await expect(
      service.submitIdentityDocument('user-1', 'expert', {
        documentType: 'passport',
        fullNameOnDoc: 'Test User',
        frontImageUrl: '/api/upload/private/33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PRIVATE_UPLOAD' });
    expect(repo.createIdentityDocument).not.toHaveBeenCalled();
  });
});
