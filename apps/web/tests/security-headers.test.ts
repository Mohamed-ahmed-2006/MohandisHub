import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('web security headers', () => {
  it('enforces an anti-framing policy on every route', () => {
    const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
    expect(config).toContain("key: 'Content-Security-Policy'");
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("{ key: 'X-Frame-Options', value: 'DENY' }");
  });
});
