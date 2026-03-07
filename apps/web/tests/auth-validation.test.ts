import { describe, expect, it } from 'vitest';

import { isValidEmail, isValidPassword } from '../lib/auth/validation';

describe('auth validation helpers', () => {
  it('validates email format', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('invalid-email')).toBe(false);
  });

  it('validates password strength policy', () => {
    expect(isValidPassword('ValidPass123')).toBe(true);
    expect(isValidPassword('short1A')).toBe(false);
    expect(isValidPassword('nouppercase123')).toBe(false);
    expect(isValidPassword('NOLOWERCASE123')).toBe(false);
    expect(isValidPassword('NoDigitsHere')).toBe(false);
  });
});
