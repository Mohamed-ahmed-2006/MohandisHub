import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('Jobs legacy-finance retirement boundary', () => {
  it('keeps Jobs independent from wallet, commission, escrow, MHC activation, and Engagements', () => {
    const service = readSource('../modules/jobs/jobs.service.ts');

    expect(service).not.toContain('WalletRepository');
    expect(service).not.toContain('walletRepo');
    expect(service).not.toContain('computeCommissionSplit');
    expect(service).not.toContain('createHoldInTransaction');
    expect(service).not.toContain('captureHoldInTransaction');
    expect(service).not.toContain('releaseHoldInTransaction');
    expect(service).not.toContain('creditWithTypeInTransaction');
    expect(service).not.toContain('debitWalletInTransaction');
    expect(service).not.toContain('mhc_job_activations');
    expect(service).not.toMatch(/engagement/i);
  });

  it('does not expose new application-fee or milestone-payment controls in the Jobs UI', () => {
    const businessJobs = readSource('../../../web/components/app/business-jobs-tab.tsx');
    const expertJobs = readSource('../../../web/components/app/expert-jobs-tab.tsx');
    const jobCard = readSource('../../../web/components/app/jobs/job-card.tsx');
    const businessMilestones = readSource(
      '../../../web/components/app/jobs/business-milestone-manager.tsx',
    );
    const expertApplications = readSource(
      '../../../web/components/app/jobs/expert-applications.tsx',
    );

    for (const source of [
      businessJobs,
      expertJobs,
      jobCard,
      businessMilestones,
      expertApplications,
    ]) {
      expect(source).not.toContain('applicationFeeAmount');
      expect(source).not.toContain('providerPayoutAmount');
      expect(source).not.toContain('commissionAmount');
      expect(source).not.toMatch(/\bEGP\b/);
    }
  });
});
