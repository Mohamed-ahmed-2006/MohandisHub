import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  JobApplicationRow,
  JobMilestoneRow,
  JobRow,
} from '../modules/jobs/jobs.repository.js';
import { JobsService } from '../modules/jobs/jobs.service.js';

const poolQueryMock = vi.fn();
const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({
  query: queryMock,
  release: releaseMock,
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({
    query: poolQueryMock,
    connect: connectMock,
  }),
}));

const makeJob = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: 'job-1',
  business_id: 'business-1',
  business_name: 'Business One',
  title: 'Job',
  description: 'Job description',
  requirements: null,
  salary_range: null,
  application_fee_amount: '20',
  interview_enabled: true,
  interview_instructions: 'Join on time',
  status: 'open',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeApp = (overrides: Partial<JobApplicationRow> = {}): JobApplicationRow => ({
  id: 'app-1',
  job_id: 'job-1',
  expert_id: 'expert-1',
  expert_name: 'Expert One',
  job_title: 'Job',
  business_name: 'Business One',
  cover_letter: null,
  submission_type: 'profile_snapshot',
  profile_snapshot: null,
  cv_file_url: null,
  application_fee_amount: '20',
  application_commission_amount: '2',
  business_payout_amount: '18',
  interview_invitation_sent_at: null,
  interview_reservation_id: null,
  status: 'pending',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const makeMilestone = (overrides: Partial<JobMilestoneRow> = {}): JobMilestoneRow => ({
  id: 'milestone-1',
  job_application_id: 'app-1',
  title: 'M1',
  amount: '50',
  wallet_hold_id: 'hold-1',
  commission_amount: '5',
  provider_payout_amount: '45',
  settled_at: null,
  status: 'active',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('JobsService hardening', () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
  });

  it('blocks milestone creation for non-accepted applications', async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeApp({ status: 'pending' })] }) // app FOR UPDATE
      .mockResolvedValueOnce({ rows: [makeJob()] }) // job FOR UPDATE
      .mockResolvedValueOnce({}); // ROLLBACK
    const service = new JobsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getAppStatus: vi.fn().mockResolvedValue({
          commissionPercent: 10,
          commissionMinEgp: 0,
        }),
      } as never,
    );

    await expect(
      service.createMilestone('app-1', 'business-1', { title: 'M1', amount: 50 }),
    ).rejects.toMatchObject({
      code: 'APPLICATION_NOT_ACCEPTED',
    });
  });

  it('blocks application chat for rejected applications', async () => {
    const repo = {
      getApplicationById: vi.fn().mockResolvedValue(makeApp({ status: 'rejected' })),
      getJobById: vi.fn().mockResolvedValue(makeJob()),
    };
    const service = new JobsService(repo as never);

    await expect(service.getApplicationMessages('app-1', 'business-1')).rejects.toMatchObject({
      code: 'APPLICATION_CHAT_NOT_ALLOWED',
    });
  });

  it('blocks accepted-app replacement after work has started', async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeApp({ id: 'app-target', status: 'pending' })] }) // app FOR UPDATE
      .mockResolvedValueOnce({ rows: [makeJob()] }) // job FOR UPDATE
      .mockResolvedValueOnce({
        rows: [
          makeApp({ id: 'app-target', status: 'pending' }),
          makeApp({ id: 'app-current', status: 'accepted' }),
        ],
      }) // apps FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ started: true }] }) // work started check
      .mockResolvedValueOnce({}); // ROLLBACK

    const service = new JobsService({} as never);

    await expect(
      service.updateApplicationStatus('app-target', 'business-1', 'accepted'),
    ).rejects.toMatchObject({
      code: 'APPLICATION_REPLACEMENT_BLOCKED',
    });
  });

  it('stores profile snapshot applications without a wallet or legacy financial mutation', async () => {
    queryMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    const repo = {
      getJobById: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '20' })),
      applyForJob: vi.fn().mockResolvedValue(
        makeApp({
          profile_snapshot: { headline: 'Expert snapshot' },
          application_fee_amount: '0',
          application_commission_amount: '0',
          business_payout_amount: '0',
        }),
      ),
    };
    const notificationsService = {
      createForUser: vi.fn().mockResolvedValue(undefined),
    };
    const profilesService = {
      getExpertProfile: vi.fn().mockResolvedValue({ headline: 'Expert snapshot' }),
      getCraftsmanProfile: vi.fn().mockResolvedValue(null),
    };

    const service = new JobsService(
      repo as never,
      notificationsService as never,
      {} as never,
      {} as never,
      {} as never,
      profilesService as never,
    );

    const result = await service.applyForJob('job-1', 'expert-1', {
      submissionType: 'profile_snapshot',
      coverLetter: 'Ready to help',
    });

    expect(profilesService.getExpertProfile).toHaveBeenCalledWith('expert-1');
    expect(repo.applyForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionType: 'profile_snapshot',
        profileSnapshot: { headline: 'Expert snapshot' },
        applicationFeeAmount: 0,
        applicationCommissionAmount: 0,
        businessPayoutAmount: 0,
      }),
      expect.any(Object),
    );
    expect(result.submissionType).toBe('profile_snapshot');
    expect(result.applicationFeeAmount).toBe(0);
    expect(result.applicationCommissionAmount).toBe(0);
    expect(result.businessPayoutAmount).toBe(0);
  });

  it('stores every new hiring post with the retired application fee set to zero', async () => {
    const repo = {
      createJob: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '0' })),
    };
    const usageQuotaService = {
      withActionLock: vi.fn(
        async (_userId: string, _feature: string, action: () => Promise<unknown>) => action(),
      ),
    };
    const service = new JobsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      { getAppStatus: vi.fn().mockResolvedValue({ featurePlansEnabled: false }) } as never,
      {} as never,
      {} as never,
      usageQuotaService as never,
    );

    const result = await service.createJob('business-1', {
      title: 'Mechanical engineer',
      description: 'Recruiting for a full-time engineering role.',
      applicationFeeAmount: 99,
    });

    expect(repo.createJob).toHaveBeenCalledWith(
      'business-1',
      expect.objectContaining({ applicationFeeAmount: 0 }),
    );
    expect(result.applicationFeeAmount).toBe(0);
  });

  it('allows applications without an EGP wallet even when a historical job fee is present', async () => {
    queryMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const repo = {
      getJobById: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '25' })),
      applyForJob: vi.fn().mockResolvedValue(
        makeApp({
          application_fee_amount: '0',
          application_commission_amount: '0',
          business_payout_amount: '0',
        }),
      ),
    };

    const service = new JobsService(
      repo as never,
      { createForUser: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      { getExpertProfile: vi.fn(), getCraftsmanProfile: vi.fn().mockResolvedValue(null) } as never,
    );

    await expect(
      service.applyForJob('job-1', 'expert-1', {
        submissionType: 'profile_snapshot',
        coverLetter: 'Ready to help',
      }),
    ).resolves.toMatchObject({ applicationFeeAmount: 0 });
    expect(repo.applyForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationFeeAmount: 0,
        applicationCommissionAmount: 0,
        businessPayoutAmount: 0,
      }),
      expect.any(Object),
    );
  });

  it('rejects external CV URLs for job applications', async () => {
    const repo = {
      getJobById: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '0' })),
    };
    const service = new JobsService(repo as never);

    await expect(
      service.applyForJob('job-1', 'expert-1', {
        submissionType: 'cv_upload',
        cvFileUrl: 'https://example.com/cv.pdf',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CV_FILE_URL',
    });
  });

  it('rejects private CV uploads not owned by the applicant', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ user_id: 'other-user' }] });
    const repo = {
      getJobById: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '0' })),
    };
    const service = new JobsService(repo as never);

    await expect(
      service.applyForJob('job-1', 'expert-1', {
        submissionType: 'cv_upload',
        cvFileUrl: '/api/upload/private/11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({
      code: 'CV_UPLOAD_NOT_OWNED',
    });
  });

  it('accepts applicant-owned private CV uploads', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ user_id: 'expert-1' }] });
    queryMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    const repo = {
      getJobById: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '0' })),
      applyForJob: vi.fn().mockResolvedValue(
        makeApp({
          submission_type: 'cv_upload',
          cv_file_url: '/api/upload/private/11111111-1111-4111-8111-111111111111',
          application_fee_amount: '0',
          application_commission_amount: '0',
          business_payout_amount: '0',
        }),
      ),
    };
    const service = new JobsService(
      repo as never,
      { createForUser: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        getAppStatus: vi.fn().mockResolvedValue({
          commissionPercent: 10,
          commissionMinEgp: 0,
          commissionReceiverId: 'platform-1',
        }),
      } as never,
    );

    const result = await service.applyForJob('job-1', 'expert-1', {
      submissionType: 'cv_upload',
      cvFileUrl: '/api/upload/private/11111111-1111-4111-8111-111111111111',
    });

    expect(repo.applyForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionType: 'cv_upload',
        cvFileUrl: '/api/upload/private/11111111-1111-4111-8111-111111111111',
      }),
      expect.any(Object),
    );
    expect(result.cvFileUrl).toBe('/api/upload/private/11111111-1111-4111-8111-111111111111');
  });

  it('creates non-financial milestones without escrow', async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeApp({ status: 'accepted' })] })
      .mockResolvedValueOnce({ rows: [makeJob()] })
      .mockResolvedValueOnce({}); // COMMIT
    const repo = {
      createMilestone: vi.fn().mockResolvedValue(
        makeMilestone({
          amount: '0',
          wallet_hold_id: null,
          commission_amount: '0',
          provider_payout_amount: '0',
        }),
      ),
      updateMilestoneStatus: vi.fn().mockResolvedValue(
        makeMilestone({
          amount: '0',
          status: 'active',
          wallet_hold_id: null,
          commission_amount: '0',
          provider_payout_amount: '0',
        }),
      ),
    };
    const service = new JobsService(repo as never);

    const result = await service.createMilestone('app-1', 'business-1', {
      title: 'M1',
      amount: 50,
    });

    expect(repo.createMilestone).toHaveBeenCalledWith('app-1', 'M1', 0, expect.any(Object));
    expect(repo.updateMilestoneStatus).toHaveBeenCalledWith(
      'milestone-1',
      'active',
      expect.any(Object),
    );
    expect(result).toMatchObject({
      amount: '0',
      walletHoldId: null,
      commissionAmount: '0',
      providerPayoutAmount: '0',
    });
  });

  it('approves submitted milestones without payout or commission', async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeMilestone({ status: 'submitted' })] })
      .mockResolvedValueOnce({ rows: [makeApp({ status: 'accepted' })] })
      .mockResolvedValueOnce({ rows: [makeJob()] })
      .mockResolvedValueOnce({}); // COMMIT
    const repo = {
      updateMilestoneStatus: vi.fn().mockResolvedValue(makeMilestone({ status: 'approved' })),
    };
    const notificationsService = { createForUser: vi.fn().mockResolvedValue(undefined) };
    const service = new JobsService(
      repo as never,
      notificationsService as never,
      {} as never,
      {} as never,
    );

    const result = await service.reviewMilestone('milestone-1', 'business-1', 'approved');

    expect(repo.updateMilestoneStatus).toHaveBeenCalledWith(
      'milestone-1',
      'approved',
      expect.any(Object),
    );
    expect(result.status).toBe('approved');
  });

  it('rejects submitted milestones without releasing the hold', async () => {
    queryMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [makeMilestone({ status: 'submitted' })] })
      .mockResolvedValueOnce({ rows: [makeApp({ status: 'accepted' })] })
      .mockResolvedValueOnce({ rows: [makeJob()] })
      .mockResolvedValueOnce({});
    const repo = {
      updateMilestoneStatus: vi.fn().mockResolvedValue(makeMilestone({ status: 'rejected' })),
    };
    const walletRepo = {
      captureHoldInTransaction: vi.fn(),
    };
    const service = new JobsService(
      repo as never,
      { createForUser: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      walletRepo as never,
      {
        getAppStatus: vi.fn().mockResolvedValue({
          commissionPercent: 10,
          commissionMinEgp: 0,
        }),
      } as never,
    );

    const result = await service.reviewMilestone('milestone-1', 'business-1', 'rejected');

    expect(walletRepo.captureHoldInTransaction).not.toHaveBeenCalled();
    expect(repo.updateMilestoneStatus).toHaveBeenCalledWith(
      'milestone-1',
      'rejected',
      expect.any(Object),
    );
    expect(result.status).toBe('rejected');
  });

  it('closes jobs without releasing historical escrow records', async () => {
    queryMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [makeJob()] })
      .mockResolvedValueOnce({});
    const repo = {
      listRefundableMilestonesForJob: vi.fn(),
      updateJobStatus: vi.fn().mockResolvedValue(makeJob({ status: 'closed' })),
    };
    const service = new JobsService(repo as never);

    const result = await service.closeJob('job-1', 'business-1');

    expect(repo.listRefundableMilestonesForJob).not.toHaveBeenCalled();
    expect(result.status).toBe('closed');
  });

  it('books invited interviews as dedicated interview reservations', async () => {
    const repo = {
      getApplicationById: vi.fn().mockResolvedValue(
        makeApp({
          status: 'interview_invited',
          submission_type: 'cv_upload',
          cv_file_url: 'https://example.com/cv.pdf',
        }),
      ),
      getJobById: vi.fn().mockResolvedValue(makeJob({ interview_enabled: true })),
      updateApplication: vi.fn().mockResolvedValue(
        makeApp({
          status: 'interview_booked',
          interview_reservation_id: 'reservation-1',
        }),
      ),
    };
    const reservationsService = {
      createJobInterviewReservation: vi.fn().mockResolvedValue({
        id: 'reservation-1',
        purpose: 'job_interview',
      }),
    };
    const notificationsService = {
      createForUser: vi.fn().mockResolvedValue(undefined),
    };

    const service = new JobsService(
      repo as never,
      notificationsService as never,
      {} as never,
      reservationsService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const reservation = await service.bookInterview('app-1', 'expert-1', {
      slotId: 'slot-1',
      mode: 'online',
    });

    expect(reservationsService.createJobInterviewReservation).toHaveBeenCalledWith({
      expertId: 'expert-1',
      businessId: 'business-1',
      jobId: 'job-1',
      jobApplicationId: 'app-1',
      slotId: 'slot-1',
      mode: 'online',
    });
    expect(repo.updateApplication).toHaveBeenCalledWith('app-1', {
      interviewReservationId: 'reservation-1',
      status: 'interview_booked',
    });
    expect(reservation).toMatchObject({
      id: 'reservation-1',
      purpose: 'job_interview',
    });
  });
});
