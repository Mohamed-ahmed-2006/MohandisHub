import { describe, expect, it, vi } from 'vitest';

import { AdminService } from '../modules/admin/admin.service.js';
import { bulkUserActionSchema } from '../modules/admin/admin.validation.js';

const operationId = '40a1d84f-9493-49e0-a455-3269570e0310';
const userId = 'd44b9e0a-e81e-4d65-8fd9-b4aa4efaa4ce';
const missingUserId = '6574610f-d42a-4544-95bd-c873c3bead21';

describe('admin bulk user actions', () => {
  it('validates unique explicit selections and action payloads', () => {
    expect(
      bulkUserActionSchema.safeParse({
        operationId,
        userIds: [userId, userId],
        action: 'activate',
      }).success,
    ).toBe(false);
    expect(
      bulkUserActionSchema.safeParse({
        operationId,
        userIds: [userId],
        action: 'assign_plan',
      }).success,
    ).toBe(false);
    expect(
      bulkUserActionSchema.safeParse({
        operationId,
        userIds: [userId],
        action: 'assign_plan',
        planId: null,
      }).success,
    ).toBe(true);
  });

  it('returns partial per-user results and revokes only valid targets', async () => {
    const items: Array<{
      user_id: string;
      status: 'pending' | 'processing' | 'succeeded' | 'skipped' | 'failed';
      code: string | null;
      message: string | null;
    }> = [
      { user_id: userId, status: 'pending', code: null, message: null },
      { user_id: missingUserId, status: 'pending', code: null, message: null },
    ];
    let completed = false;
    const repo = {
      reserveBulkUserOperation: vi.fn().mockResolvedValue('created'),
      getBulkUserOperation: vi.fn().mockImplementation(() =>
        Promise.resolve({
          id: operationId,
          action: 'force_logout',
          status: completed ? 'completed' : 'processing',
          requested_count: 2,
          succeeded_count: items.filter((item) => item.status === 'succeeded').length,
          skipped_count: items.filter((item) => item.status === 'skipped').length,
          failed_count: items.filter((item) => item.status === 'failed').length,
          items,
        }),
      ),
      claimBulkUserOperationItem: vi.fn().mockImplementation(
        (_operationId: string, claimedUserId: string) => {
          const item = items.find((entry) => entry.user_id === claimedUserId)!;
          if (item.status !== 'pending') return Promise.resolve(false);
          item.status = 'processing';
          return Promise.resolve(true);
        },
      ),
      getUserById: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(
          id === userId
            ? {
                id,
                is_admin: false,
                admin_permissions: [],
                is_active: true,
                email_verified_at: null,
                plan_id: null,
              }
            : null,
        ),
      ),
      completeBulkUserOperationItem: vi.fn().mockImplementation(
        (result: {
          userId: string;
          status: 'succeeded' | 'skipped' | 'failed';
          code?: string | null;
          message?: string | null;
        }) => {
          const item = items.find((entry) => entry.user_id === result.userId)!;
          item.status = result.status;
          item.code = result.code ?? null;
          item.message = result.message ?? null;
          return Promise.resolve();
        },
      ),
      finishBulkUserOperation: vi.fn().mockImplementation(() => {
        completed = true;
        return Promise.resolve();
      }),
    };
    const auth = { revokeAllUserTokens: vi.fn().mockResolvedValue(undefined) };
    const service = new AdminService(
      repo as never,
      {} as never,
      {} as never,
      auth as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.bulkUserAction(
      {
        operationId,
        userIds: [userId, missingUserId],
        action: 'force_logout',
      },
      { actorId: 'f97f9026-9d00-4c70-a120-d7be9a66271e', actorIsSuperAdmin: false },
    );

    expect(result).toMatchObject({
      status: 'completed',
      requestedCount: 2,
      succeededCount: 1,
      failedCount: 1,
    });
    expect(auth.revokeAllUserTokens).toHaveBeenCalledWith(userId);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId, status: 'succeeded' }),
        expect.objectContaining({
          userId: missingUserId,
          status: 'failed',
          code: 'USER_NOT_FOUND',
        }),
      ]),
    );
  });
});
