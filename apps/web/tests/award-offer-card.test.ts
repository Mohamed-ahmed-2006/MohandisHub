import { describe, expect, it } from 'vitest';

import type { Bid } from '@/lib/needs/client';

describe('P1-12 pending award offer card filtering and sorting', () => {
  const filterAndSortOffers = (bids: Partial<Bid>[]): Partial<Bid>[] => {
    return bids
      .filter((b) => {
        if (b.status !== 'awarded' && b.status !== 'pending_activation') return false;
        if (b.expires_at) {
          const expTime = new Date(b.expires_at).getTime();
          if (Number.isFinite(expTime) && expTime <= Date.now()) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const tA = a.expires_at ? new Date(a.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
        const tB = b.expires_at ? new Date(b.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
        return tA - tB;
      });
  };

  it('returns empty array when there are no offers', () => {
    expect(filterAndSortOffers([])).toEqual([]);
  });

  it('includes single active pending offer', () => {
    const offer: Partial<Bid> = { id: 'b-1', status: 'awarded', expires_at: new Date(Date.now() + 3600000).toISOString() };
    expect(filterAndSortOffers([offer])).toEqual([offer]);
  });

  it('sorts multiple offers by nearest expiration first', () => {
    const near: Partial<Bid> = { id: 'b-near', status: 'awarded', expires_at: new Date(Date.now() + 100000).toISOString() };
    const far: Partial<Bid> = { id: 'b-far', status: 'awarded', expires_at: new Date(Date.now() + 500000).toISOString() };
    const noExpiry: Partial<Bid> = { id: 'b-none', status: 'awarded', expires_at: null };

    const sorted = filterAndSortOffers([far, noExpiry, near]);
    expect(sorted.map((b) => b.id)).toEqual(['b-near', 'b-far', 'b-none']);
  });

  it('excludes expired offers', () => {
    const expired: Partial<Bid> = { id: 'b-exp', status: 'awarded', expires_at: new Date(Date.now() - 1000).toISOString() };
    const active: Partial<Bid> = { id: 'b-act', status: 'awarded', expires_at: new Date(Date.now() + 3600000).toISOString() };

    expect(filterAndSortOffers([expired, active])).toEqual([active]);
  });

  it('excludes activated, declined, and withdrawn offers', () => {
    const activated: Partial<Bid> = { id: 'b-1', status: 'activated' };
    const declined: Partial<Bid> = { id: 'b-2', status: 'declined' };
    const withdrawn: Partial<Bid> = { id: 'b-3', status: 'withdrawn' };
    const pending: Partial<Bid> = { id: 'b-4', status: 'pending_activation' };

    expect(filterAndSortOffers([activated, declined, withdrawn, pending])).toEqual([pending]);
  });
});
