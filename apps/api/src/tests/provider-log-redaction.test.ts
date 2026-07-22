import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('provider error redaction', () => {
  it('does not log or throw raw email and SMS provider response bodies', () => {
    const otp = readFileSync(new URL('../modules/otp/otp.provider.ts', import.meta.url), 'utf8');
    const transactional = readFileSync(
      new URL('../utils/send-transactional-email.ts', import.meta.url),
      'utf8',
    );
    const resend = readFileSync(new URL('../utils/resend-email.ts', import.meta.url), 'utf8');

    expect(otp).not.toContain('body: await response.text()');
    expect(otp).not.toContain('body: errorText');
    expect(transactional).not.toContain('errorText');
    expect(resend).not.toContain('error.message');
  });
});
