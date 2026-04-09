import { describe, expect, it } from 'vitest';

import {
  canAccessProviderAnalytics,
  canBidOnNeeds,
  canManageNeeds,
  canManageReservationAvailability,
  canRequestWithdrawal,
  isCustomerRole,
} from './roles.js';

describe('role policy helpers', () => {
  it('recognizes customer-only permissions', () => {
    expect(isCustomerRole('customer')).toBe(true);
    expect(canManageNeeds('customer')).toBe(true);
    expect(canManageNeeds('expert')).toBe(false);
    expect(canManageNeeds('craftsman')).toBe(false);
    expect(canManageNeeds('business')).toBe(false);
  });

  it('allows provider roles to bid; experts, craftsmen, and businesses can withdraw', () => {
    expect(canBidOnNeeds('expert')).toBe(true);
    expect(canBidOnNeeds('craftsman')).toBe(true);
    expect(canBidOnNeeds('business')).toBe(true);
    expect(canBidOnNeeds('customer')).toBe(false);

    expect(canRequestWithdrawal('expert')).toBe(true);
    expect(canRequestWithdrawal('craftsman')).toBe(true);
    expect(canRequestWithdrawal('business')).toBe(true);
  });

  it('allows all provider roles to access provider surfaces', () => {
    expect(canAccessProviderAnalytics('expert')).toBe(true);
    expect(canAccessProviderAnalytics('craftsman')).toBe(true);
    expect(canAccessProviderAnalytics('business')).toBe(true);
    expect(canAccessProviderAnalytics('customer')).toBe(false);

    expect(canManageReservationAvailability('expert')).toBe(true);
    expect(canManageReservationAvailability('craftsman')).toBe(true);
    expect(canManageReservationAvailability('business')).toBe(true);
    expect(canManageReservationAvailability('customer')).toBe(false);
  });
});
