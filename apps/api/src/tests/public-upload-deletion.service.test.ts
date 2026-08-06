import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PublicUploadDeletionService,
  type PublicUploadObject,
} from '../modules/upload/public-upload-deletion.service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const uploadId = '44444444-4444-4444-8444-444444444444';
const key = '1690000000-abc-photo.jpg';
const publicUrl = `https://project.supabase.co/storage/v1/object/public/uploads/${key}`;
// Source text is asserted verbatim, including line breaks. Normalize CRLF so the
// assertions hold on checkouts where git materializes native (Windows) line endings;
// the asserted content itself is unchanged.
const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const row = (overrides: Partial<PublicUploadObject> = {}): PublicUploadObject => ({
  id: uploadId,
  userId: ownerId,
  bucket: 'uploads',
  storagePath: key,
  visibility: 'public',
  state: 'active',
  ...overrides,
});

describe('PublicUploadDeletionService', () => {
  const repository = {
    findById: vi.fn(),
    findActiveByLocation: vi.fn(),
    claimDeletion: vi.fn(),
    completeDeletion: vi.fn(),
    failDeletion: vi.fn(),
  };
  const storage = {
    deleteLocal: vi.fn(),
    deleteSupabase: vi.fn(),
  };
  const service = new PublicUploadDeletionService(repository, storage, {
    supabaseOrigin: 'https://project.supabase.co',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findById.mockResolvedValue(row());
    repository.findActiveByLocation.mockResolvedValue(row());
    repository.claimDeletion.mockResolvedValue(row({ state: 'pending_delete' }));
    repository.completeDeletion.mockResolvedValue(undefined);
    repository.failDeletion.mockResolvedValue(undefined);
    storage.deleteSupabase.mockResolvedValue(undefined);
    storage.deleteLocal.mockReturnValue(true);
  });

  it('registers public uploads and exposes deletion only by trusted object id', () => {
    const routes = readSource('../modules/upload/upload.routes.ts');

    expect(routes).toContain('publicUploadRepository.insertActive');
    expect(routes).toContain("uploadRouter.delete(\n  '/public/:id'");
    expect(routes).toContain("hasAdminPermission(user, 'manage_media')");
    expect(routes).not.toMatch(/deleteById\(\{[^}]*url/s);
  });

  it('makes moderation and retention match owner-bearing records through the registry', () => {
    const moderation = readSource('../modules/moderation/moderation.service.ts');
    const retention = readSource('../modules/retention/retention.service.ts');
    const retentionRepository = readSource('../modules/retention/retention.repository.ts');

    expect(moderation).not.toContain('resolvePublicUploadRef');
    expect(moderation).toContain('expectedOwnerId: resourceOwnerId');
    expect(moderation).toContain('SELECT reference_url, customer_id FROM needs');
    expect(moderation).toContain('SELECT attachment_url, sender_id FROM bid_messages');
    expect(moderation).toContain('SELECT images, provider_id FROM services');
    expect(retention).not.toContain('resolvePublicUploadRef');
    expect(retention).toContain('expectedOwnerId: resourceOwnerId');
    expect(retentionRepository).toContain('SELECT id, reference_url, customer_id FROM needs');
    expect(retentionRepository).toContain('SELECT id, attachment_url, sender_id FROM bid_messages');
  });

  it('lets an owner delete their own registered public media', async () => {
    await expect(
      service.deleteById({ uploadObjectId: uploadId, actorId: ownerId, allowAdmin: false }),
    ).resolves.toEqual({ filesRemoved: 1 });

    expect(repository.claimDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ uploadObjectId: uploadId, actorId: ownerId, allowAdmin: false }),
    );
    expect(storage.deleteSupabase).toHaveBeenCalledWith('uploads', [key]);
    expect(repository.completeDeletion).toHaveBeenCalledWith(uploadId);
  });

  it("does not let another user delete the owner's media", async () => {
    await expect(
      service.deleteById({ uploadObjectId: uploadId, actorId: otherId, allowAdmin: false }),
    ).rejects.toMatchObject({ code: 'PUBLIC_UPLOAD_FORBIDDEN' });

    expect(repository.claimDeletion).not.toHaveBeenCalled();
    expect(storage.deleteSupabase).not.toHaveBeenCalled();
  });

  it.each([
    ['external URL', `https://evil.example/storage/v1/object/public/uploads/${key}`],
    [
      'different bucket',
      `https://project.supabase.co/storage/v1/object/public/verification-docs/${key}`,
    ],
    ['path traversal', 'https://project.supabase.co/storage/v1/object/public/uploads/../secret'],
    [
      'encoded traversal',
      'https://project.supabase.co/storage/v1/object/public/uploads/%2e%2e%2fsecret',
    ],
    [
      'double-encoded traversal',
      'https://project.supabase.co/storage/v1/object/public/uploads/%252e%252e%252fsecret',
    ],
    ['query modification', `${publicUrl}?bucket=verification-docs`],
  ])('rejects %s without deleting storage', async (_label, referenceUrl) => {
    await expect(
      service.deleteTrustedReference({
        referenceUrl,
        expectedOwnerId: ownerId,
        actorId: adminId,
        allowAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'UNTRUSTED_PUBLIC_UPLOAD_REFERENCE' });

    expect(repository.findActiveByLocation).not.toHaveBeenCalled();
    expect(storage.deleteSupabase).not.toHaveBeenCalled();
  });

  it('rejects a modified object key that has no exact registry record', async () => {
    repository.findActiveByLocation.mockResolvedValueOnce(null);

    await expect(
      service.deleteTrustedReference({
        referenceUrl: publicUrl.replace(key, '1690000000-abc-other.jpg'),
        expectedOwnerId: ownerId,
        actorId: adminId,
        allowAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'UNTRUSTED_PUBLIC_UPLOAD_REFERENCE' });

    expect(storage.deleteSupabase).not.toHaveBeenCalled();
  });

  it('rejects a valid-looking URL without a matching trusted database record', async () => {
    repository.findActiveByLocation.mockResolvedValueOnce(null);

    await expect(
      service.deleteTrustedReference({
        referenceUrl: publicUrl,
        expectedOwnerId: ownerId,
        actorId: adminId,
        allowAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'UNTRUSTED_PUBLIC_UPLOAD_REFERENCE' });

    expect(repository.claimDeletion).not.toHaveBeenCalled();
    expect(storage.deleteSupabase).not.toHaveBeenCalled();
  });

  it('rejects a registry record owned by someone other than the resource owner', async () => {
    repository.findActiveByLocation.mockResolvedValueOnce(row({ userId: otherId }));

    await expect(
      service.deleteTrustedReference({
        referenceUrl: publicUrl,
        expectedOwnerId: ownerId,
        actorId: adminId,
        allowAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'UNTRUSTED_PUBLIC_UPLOAD_REFERENCE' });

    expect(storage.deleteSupabase).not.toHaveBeenCalled();
  });

  it('allows an authorized administrator to delete an owner-matched registered reference', async () => {
    await expect(
      service.deleteTrustedReference({
        referenceUrl: publicUrl,
        expectedOwnerId: ownerId,
        actorId: adminId,
        allowAdmin: true,
      }),
    ).resolves.toEqual({ filesRemoved: 1 });

    expect(storage.deleteSupabase).toHaveBeenCalledWith('uploads', [key]);
  });

  it('records a failed storage deletion without silently completing it', async () => {
    storage.deleteSupabase.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(
      service.deleteById({ uploadObjectId: uploadId, actorId: ownerId, allowAdmin: false }),
    ).rejects.toThrow('storage unavailable');

    expect(repository.failDeletion).toHaveBeenCalledWith(uploadId, 'storage unavailable');
    expect(repository.completeDeletion).not.toHaveBeenCalled();
  });
});
