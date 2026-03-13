import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobApplicationRow, JobRow } from '../modules/jobs/jobs.repository.js';
import { JobsService } from '../modules/jobs/jobs.service.js';

const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({
  query: queryMock,
  release: releaseMock,
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({
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

describe('JobsService hardening', () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
  });

  it('blocks milestone creation for non-accepted applications', async () => {
    const repo = {
      getApplicationById: vi.fn().mockResolvedValue(makeApp({ status: 'pending' })),
      getJobById: vi.fn().mockResolvedValue(makeJob()),
    };
    const service = new JobsService(repo as never);

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

  it('stores paid profile snapshot applications and splits wallet amounts', async () => {
    queryMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    const repo = {
      getJobById: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '20' })),
      applyForJob: vi.fn().mockResolvedValue(
        makeApp({
          profile_snapshot: { headline: 'Expert snapshot' },
          application_fee_amount: '20',
          application_commission_amount: '3',
          business_payout_amount: '17',
        }),
      ),
    };
    const notificationsService = {
      createForUser: vi.fn().mockResolvedValue(undefined),
    };
    const walletRepo = {
      findByUserId: vi.fn((userId: string) => {
        if (userId === 'expert-1') return Promise.resolve({ id: 'wallet-expert' });
        if (userId === 'business-1') return Promise.resolve({ id: 'wallet-business' });
        return Promise.resolve(null);
      }),
      createForUser: vi.fn().mockResolvedValue({ id: 'wallet-business' }),
      getOrCreateCommissionWallet: vi.fn().mockResolvedValue('wallet-platform'),
      debitWalletInTransaction: vi.fn().mockResolvedValue('tx-1'),
      creditWithTypeInTransaction: vi.fn().mockResolvedValue(undefined),
    };
    const settingsService = {
      getAppStatus: vi.fn().mockResolvedValue({
        commissionPercent: 10,
        commissionMinEgp: 3,
        commissionReceiverId: 'platform-1',
      }),
    };
    const profilesService = {
      getExpertProfile: vi.fn().mockResolvedValue({ headline: 'Expert snapshot' }),
    };

    const service = new JobsService(
      repo as never,
      notificationsService as never,
      {} as never,
      {} as never,
      walletRepo as never,
      settingsService as never,
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
        applicationFeeAmount: 20,
        applicationCommissionAmount: 3,
        businessPayoutAmount: 17,
      }),
      expect.any(Object),
    );
    expect(walletRepo.debitWalletInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      'wallet-expert',
      'expert-1',
      20,
      'Paid hiring application submission',
      'job_application',
      'app-1',
    );
    expect(walletRepo.creditWithTypeInTransaction).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      'wallet-business',
      'business-1',
      17,
      'payment',
      'Hiring application payout',
      'job_application',
      'app-1',
    );
    expect(walletRepo.creditWithTypeInTransaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      'wallet-platform',
      'platform-1',
      3,
      'commission',
      'Hiring application commission',
      'job_application',
      'app-1',
    );
    expect(result.submissionType).toBe('profile_snapshot');
    expect(result.applicationCommissionAmount).toBe(3);
    expect(result.businessPayoutAmount).toBe(17);
  });

  it('blocks paid applications when expert wallet is missing', async () => {
    const repo = {
      getJobById: vi.fn().mockResolvedValue(makeJob({ application_fee_amount: '25' })),
    };
    const walletRepo = {
      findByUserId: vi.fn().mockResolvedValue(null),
    };

    const service = new JobsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      walletRepo as never,
      {
        getAppStatus: vi.fn().mockResolvedValue({
          commissionPercent: 10,
          commissionMinEgp: 3,
          commissionReceiverId: 'platform-1',
        }),
      } as never,
      { getExpertProfile: vi.fn() } as never,
    );

    await expect(
      service.applyForJob('job-1', 'expert-1', {
        submissionType: 'profile_snapshot',
        coverLetter: 'Ready to help',
      }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
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
