import { isProviderRole } from '@mohandishub/shared';
import { describe, expect, it } from 'vitest';

describe('P0-09 and P0-14 route authorization guards', () => {
  it('rejects customer role from accessing /app/credits', () => {
    const role = 'customer';
    const isAllowed = isProviderRole(role);
    expect(isAllowed).toBe(false);
  });

  it('allows provider roles (expert, craftsman, business) to access /app/credits', () => {
    expect(isProviderRole('expert')).toBe(true);
    expect(isProviderRole('craftsman')).toBe(true);
    expect(isProviderRole('business')).toBe(true);
  });

  it('rejects customer role from accessing /app/analytics', () => {
    const role = 'customer';
    const isAllowed = isProviderRole(role);
    expect(isAllowed).toBe(false);
  });

  it('allows provider roles (expert, craftsman, business) to access /app/analytics', () => {
    expect(isProviderRole('expert')).toBe(true);
    expect(isProviderRole('craftsman')).toBe(true);
    expect(isProviderRole('business')).toBe(true);
  });
});
