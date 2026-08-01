import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MhcRepository } from '../modules/mhc/mhc.repository.js';
import { MhcService } from '../modules/mhc/mhc.service.js';

// ---------------------------------------------------------------------------
// Award-offer lifecycle: decline, customer withdrawal, expiry, re-award.
// ---------------------------------------------------------------------------
// Decision D4. None of these paths may ever charge MHC — an offer is not a job.
// Every release goes through one locked implementation, so the three reasons
// cannot drift apart.
// ---------------------------------------------------------------------------

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({ query: clientQueryMock, release: releaseMock }));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: connectMock }),
  hasDatabaseConfig: () => true,
}));
vi.mock('../config/env.js', () => ({ env: {} }));

const notifyMock = vi.fn<(userId: string, payload: Record<string, unknown>) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock('../modules/notifications/notifications.service.js', () => ({
  NotificationsService: class {
    createForUser = notifyMock;
  },
}));

const PENDING_NEED = {
  status: 'awarded_pending_provider_acceptance',
  pending_award_bid_id: 'bid-1',
};

/** Mock the locked release transaction against a given need state. */
function mockRelease(need: Record<string, unknown> | null) {
  clientQueryMock.mockImplementation((sql: string) => {
    if (/SELECT status, pending_award_bid_id FROM needs WHERE id = \$1 FOR UPDATE/.test(sql)) {
      return { rows: need ? [need] : [] };
    }
    return { rows: [], rowCount: 1 };
  });
}

const executed = (): string[] => clientQueryMock.mock.calls.map((c) => String(c[0]));
const chargedLedger = (): boolean => executed().some((s) => /INSERT INTO transactions/.test(s));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('release is race-safe and never charges', () => {
  it('releases a live pending award', async () => {
    mockRelease({ ...PENDING_NEED });
    const result = await new MhcRepository().releasePendingAwardForBid(
      'need-1',
      'bid-1',
      'expired',
    );
    expect(result.released).toBe(true);
    expect(chargedLedger()).toBe(false);
  });

  it('refuses to release when the provider already activated', async () => {
    // The need has moved to 'awarded'. Tearing it down here would undo a job the
    // provider has already paid real credits for.
    mockRelease({ status: 'awarded', pending_award_bid_id: null });
    const result = await new MhcRepository().releasePendingAwardForBid(
      'need-1',
      'bid-1',
      'expired',
    );
    expect(result.released).toBe(false);
    expect(executed().some((s) => /UPDATE needs/.test(s))).toBe(false);
  });

  it('refuses to release when the offer moved to a different bid', async () => {
    mockRelease({ ...PENDING_NEED, pending_award_bid_id: 'bid-2' });
    const result = await new MhcRepository().releasePendingAwardForBid(
      'need-1',
      'bid-1',
      'expired',
    );
    expect(result.released).toBe(false);
  });

  it('locks the need before writing', async () => {
    mockRelease({ ...PENDING_NEED });
    await new MhcRepository().releasePendingAwardForBid('need-1', 'bid-1', 'withdrawn');
    const order = executed();
    const lock = order.findIndex((s) => /FROM needs WHERE id = \$1 FOR UPDATE/.test(s));
    const write = order.findIndex((s) => /UPDATE bids/.test(s));
    expect(lock).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(lock);
  });

  it('returns a declined bid to rejected, but a withdrawn or expired one to pending', async () => {
    // A decline is the provider opting out. A withdrawal or expiry is not their
    // fault, so the bid stays available for a later award.
    for (const [reason, expected] of [
      ['rejected', 'rejected'],
      ['withdrawn', 'pending'],
      ['expired', 'pending'],
    ] as const) {
      vi.clearAllMocks();
      mockRelease({ ...PENDING_NEED });
      await new MhcRepository().releasePendingAwardForBid('need-1', 'bid-1', reason);
      const bidUpdate = clientQueryMock.mock.calls.find((c) => /UPDATE bids/.test(String(c[0])));
      expect((bidUpdate?.[1] as unknown[])[1]).toBe(expected);
    }
  });
});

describe('provider decline', () => {
  const bidRow = {
    bid_id: 'bid-1',
    need_id: 'need-1',
    expert_id: 'provider-1',
    bid_status: 'awarded_pending',
    need_status: 'awarded_pending_provider_acceptance',
    customer_id: 'customer-1',
  };

  it('releases the offer, charges nothing, and tells the customer', async () => {
    poolQueryMock.mockImplementation(() => ({ rows: [bidRow] }) as never);
    mockRelease({ ...PENDING_NEED });

    const result = await new MhcService().rejectAwardForProvider({
      userId: 'provider-1',
      role: 'expert',
      bidId: 'bid-1',
    });

    expect(result).toMatchObject({ needId: 'need-1', rejected: true });
    expect(chargedLedger()).toBe(false);
    expect(notifyMock).toHaveBeenCalledWith(
      'customer-1',
      expect.objectContaining({
        payload: { needId: 'need-1', bidId: 'bid-1', reason: 'declined' },
      }),
    );
  });

  it('reports a conflict when the offer vanished before the locked release', async () => {
    poolQueryMock.mockImplementation(() => ({ rows: [bidRow] }) as never);
    mockRelease({ status: 'awarded', pending_award_bid_id: null });

    await expect(
      new MhcService().rejectAwardForProvider({
        userId: 'provider-1',
        role: 'expert',
        bidId: 'bid-1',
      }),
    ).rejects.toMatchObject({ code: 'NO_PENDING_AWARD', statusCode: 409 });
  });

  it('refuses a provider who does not own the bid', async () => {
    poolQueryMock.mockImplementation(
      () => ({ rows: [{ ...bidRow, expert_id: 'other' }] }) as never,
    );
    await expect(
      new MhcService().rejectAwardForProvider({
        userId: 'provider-1',
        role: 'expert',
        bidId: 'bid-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_BID_OWNER', statusCode: 403 });
  });
});

describe('customer withdrawal', () => {
  const needRow = {
    customer_id: 'customer-1',
    status: 'awarded_pending_provider_acceptance',
    pending_award_bid_id: 'bid-1',
    expert_id: 'provider-1',
  };

  it('withdraws an unaccepted award and notifies the provider', async () => {
    poolQueryMock.mockImplementation(() => ({ rows: [needRow] }) as never);
    mockRelease({ ...PENDING_NEED });

    const result = await new MhcService().withdrawAwardForCustomer({
      userId: 'customer-1',
      needId: 'need-1',
    });

    expect(result).toMatchObject({ withdrawn: true, bidId: 'bid-1' });
    expect(chargedLedger()).toBe(false);
    expect(notifyMock).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({
        payload: { needId: 'need-1', bidId: 'bid-1', reason: 'withdrawn' },
      }),
    );
  });

  it('refuses once the provider has paid — their credits are already spent', async () => {
    poolQueryMock.mockImplementation(() => ({ rows: [needRow] }) as never);
    mockRelease({ status: 'awarded', pending_award_bid_id: null });

    await expect(
      new MhcService().withdrawAwardForCustomer({ userId: 'customer-1', needId: 'need-1' }),
    ).rejects.toMatchObject({ code: 'AWARD_ALREADY_ACTIVATED', statusCode: 409 });
  });

  it('refuses a non-owner', async () => {
    poolQueryMock.mockImplementation(() => ({ rows: [needRow] }) as never);
    await expect(
      new MhcService().withdrawAwardForCustomer({ userId: 'someone-else', needId: 'need-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('refuses when there is no pending award', async () => {
    poolQueryMock.mockImplementation(
      () => ({ rows: [{ ...needRow, status: 'open', pending_award_bid_id: null }] }) as never,
    );
    await expect(
      new MhcService().withdrawAwardForCustomer({ userId: 'customer-1', needId: 'need-1' }),
    ).rejects.toMatchObject({ code: 'NO_PENDING_AWARD', statusCode: 409 });
  });
});

describe('expiry sweep', () => {
  it('releases due offers and notifies both parties', async () => {
    poolQueryMock.mockImplementation((sql: string) => {
      if (/FROM needs n\s+JOIN bids b/.test(sql)) {
        return {
          rows: [
            {
              need_id: 'need-1',
              bid_id: 'bid-1',
              provider_user_id: 'provider-1',
              customer_id: 'customer-1',
            },
          ],
        };
      }
      return { rows: [] };
    });
    mockRelease({ ...PENDING_NEED });

    const result = await new MhcService().expirePendingAwards(10);

    expect(result).toEqual({ examined: 1, released: 1 });
    expect(chargedLedger()).toBe(false);
    const notified = notifyMock.mock.calls.map((c) => c[0]);
    expect(notified).toContain('provider-1');
    expect(notified).toContain('customer-1');
  });

  it('does not notify for an offer that was activated just before the sweep', async () => {
    poolQueryMock.mockImplementation((sql: string) => {
      if (/FROM needs n\s+JOIN bids b/.test(sql)) {
        return {
          rows: [
            {
              need_id: 'need-1',
              bid_id: 'bid-1',
              provider_user_id: 'provider-1',
              customer_id: 'customer-1',
            },
          ],
        };
      }
      return { rows: [] };
    });
    // Provider paid in the gap between the sweep query and the release.
    mockRelease({ status: 'awarded', pending_award_bid_id: null });

    const result = await new MhcService().expirePendingAwards(10);

    expect(result).toEqual({ examined: 1, released: 0 });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('handles an empty sweep', async () => {
    poolQueryMock.mockImplementation(() => ({ rows: [] }) as never);
    await expect(new MhcService().expirePendingAwards(10)).resolves.toEqual({
      examined: 0,
      released: 0,
    });
  });
});
