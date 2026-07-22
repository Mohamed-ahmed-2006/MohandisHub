import crypto from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../config/env.js';
import {
  DiditVerificationProvider,
  type IVerificationProvider,
} from '../modules/verification/verification.provider.js';
import { VerificationService } from '../modules/verification/verification.service.js';

describe('verification trust boundaries', () => {
  it('uses account contact details instead of client-controlled identity details', async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    const provider: IVerificationProvider = {
      name: 'fake',
      createSession,
      handleWebhook: vi.fn(),
    };
    const verificationRepo = {
      findLatestByUserId: vi.fn().mockResolvedValue(null),
      createRequest: vi.fn().mockResolvedValue({ id: 'request-1' }),
      updateProfileVerificationStatus: vi.fn(),
    };
    const profilesRepo = {
      getUserAvatarUrl: vi.fn().mockResolvedValue('/avatar.png'),
      findIdentityDocuments: vi.fn().mockResolvedValue([]),
      findUserBasicById: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'stored@example.com',
        display_name: 'Stored Name',
        primary_role: 'expert',
      }),
    };
    const service = new VerificationService(
      verificationRepo as never,
      profilesRepo as never,
      provider,
    );

    await service.initiate({ userId: 'user-1', role: 'expert' });

    expect(createSession).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'stored@example.com',
      displayName: 'Stored Name',
      type: 'identity',
    });
  });

  it('does not apply profile changes when a terminal transition loses a race', async () => {
    const provider: IVerificationProvider = {
      name: 'fake',
      createSession: vi.fn(),
      handleWebhook: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        approved: true,
        rawPayload: {},
      }),
    };
    const verificationRepo = {
      findByProviderSessionId: vi.fn().mockResolvedValue({
        id: 'request-1',
        user_id: 'user-1',
        request_type: 'identity',
        provider: 'didit',
        status: 'initiated',
      }),
      transitionStatus: vi.fn().mockResolvedValue(false),
      markIdentityApproved: vi.fn(),
      updateProfileVerificationStatus: vi.fn(),
    };
    const service = new VerificationService(verificationRepo as never, {} as never, provider);

    await service.handleWebhook({}, {});

    expect(verificationRepo.markIdentityApproved).not.toHaveBeenCalled();
    expect(verificationRepo.updateProfileVerificationStatus).not.toHaveBeenCalled();
  });
});

describe('Didit webhook replay protection', () => {
  const original = {
    apiKey: env.DIDIT_API_KEY,
    secret: env.DIDIT_WEBHOOK_SECRET,
    workflowId: env.DIDIT_WORKFLOW_ID,
  };

  afterEach(() => {
    env.DIDIT_API_KEY = original.apiKey;
    env.DIDIT_WEBHOOK_SECRET = original.secret;
    env.DIDIT_WORKFLOW_ID = original.workflowId;
  });

  const makeProvider = (): DiditVerificationProvider => {
    env.DIDIT_API_KEY = 'didit-test-key';
    env.DIDIT_WEBHOOK_SECRET = 'didit-test-secret';
    env.DIDIT_WORKFLOW_ID = 'didit-test-workflow';
    return new DiditVerificationProvider();
  };

  it('rejects a signed old body paired with a fresh timestamp header', async () => {
    const provider = makeProvider();
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const freshTimestamp = Math.floor(Date.now() / 1000);
    const body = {
      session_id: 'session-1',
      status: 'Approved',
      webhook_type: 'status.updated',
      timestamp: oldTimestamp,
    };
    const signatureSimple = crypto
      .createHmac('sha256', 'didit-test-secret')
      .update(`${oldTimestamp}:session-1:Approved:status.updated`)
      .digest('hex');

    await expect(
      provider.handleWebhook(body, {
        timestamp: String(freshTimestamp),
        signatureSimple,
      }),
    ).rejects.toThrow('Invalid Didit webhook signature');
  });

  it('rejects non-numeric timestamp headers instead of bypassing freshness checks', async () => {
    const provider = makeProvider();
    const body = {
      session_id: 'session-1',
      status: 'Approved',
      webhook_type: 'status.updated',
      timestamp: Math.floor(Date.now() / 1000),
    };

    await expect(
      provider.handleWebhook(body, { timestamp: 'not-a-number', signatureSimple: 'ignored' }),
    ).rejects.toThrow('Invalid Didit webhook signature');
  });
});
