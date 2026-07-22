import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('advertising backend launch gate', () => {
  it('defaults off and returns no active campaigns while disabled', () => {
    const envSource = readFileSync(new URL('../config/env.ts', import.meta.url), 'utf8');
    const service = readFileSync(
      new URL('../modules/advertisements/advertisements.service.ts', import.meta.url),
      'utf8',
    );

    expect(envSource).toContain('ADVERTISEMENTS_ENABLED: booleanEnv(false)');
    expect(service).toContain('const DEFAULT_AD_CONTROLS = { acceptAds: false');
    expect(service).toContain('if (!env.ADVERTISEMENTS_ENABLED) return []');
  });
});
