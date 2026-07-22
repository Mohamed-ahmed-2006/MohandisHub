import { afterEach, describe, expect, it, vi } from 'vitest';

import { patchRetentionGovernanceSchema } from '../modules/retention/retention.admin.validation.js';
import { sendRetentionAlert } from '../modules/retention/retention.alerts.js';

describe('retention alert outbound-request safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects arbitrary webhook destinations in admin settings', () => {
    expect(
      patchRetentionGovernanceSchema.safeParse({
        alerts: { webhookUrl: 'http://169.254.169.254/latest/meta-data' },
      }).success,
    ).toBe(false);
    expect(
      patchRetentionGovernanceSchema.safeParse({
        alerts: { webhookUrl: 'https://hooks.example.com/retention' },
      }).success,
    ).toBe(false);
    expect(patchRetentionGovernanceSchema.safeParse({ alerts: { webhookUrl: '' } }).success).toBe(
      true,
    );
  });

  it('does not call stored legacy webhook URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await sendRetentionAlert(
      { webhookUrl: 'https://legacy.example.com/hook' },
      { type: 'sweep_failed', message: 'test' },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
