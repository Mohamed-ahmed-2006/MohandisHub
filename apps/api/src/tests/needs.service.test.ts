import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BidRow, NeedRow } from '../modules/needs/needs.repository.js';
import { NeedsService } from '../modules/needs/needs.service.js';

const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({
  query: queryMock,
  release: releaseMock,
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({
    connect: connectMock,
  }),
}));

const makeNeed = (overrides: Partial<NeedRow> = {}): NeedRow => ({
  id: 'need-1',
  customer_id: 'customer-1',
  title: 'Need',
  description: 'Need description',
  category_id: null,
  budget_type: 'fixed',
  budget_amount: '100',
  currency: 'EGP',
  timeline_days: null,
  city: null,
  country: null,
  reference_url: null,
  status: 'awarded',
  awarded_bid_id: 'bid-1',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const enabledNeedsStatus = {
  featureNeedsEnabled: true,
  pauseAwardBids: false,
  moneyMovementsPaused: false,
};

const makeBid = (overrides: Partial<BidRow> = {}): BidRow => ({
  id: 'bid-1',
  need_id: 'need-1',
  expert_id: 'expert-1',
  amount: '100',
  currency: 'EGP',
  message: 'hello',
  delivery_days: null,
  estimated_hours: null,
  status: 'accepted',
  paid_at: null,
  payment_transaction_id: null,
  customer_last_read_at: null,
  expert_last_read_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('NeedsService hardening', () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
  });

  it('blocks winner replacement after payment has started', async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeNeed()] }) // need FOR UPDATE
      .mockResolvedValueOnce({
        rows: [
          makeBid({ id: 'bid-2', status: 'pending' }),
          makeBid({ id: 'bid-1', status: 'accepted', paid_at: new Date().toISOString() }),
        ],
      }) // bids FOR UPDATE
      .mockResolvedValueOnce({}); // ROLLBACK

    const settingsService = {
      getAppStatus: vi.fn().mockResolvedValue({ ...enabledNeedsStatus, pauseAwardBids: false }),
    };
    const walletRepo = {};
    const repo = {};
    const service = new NeedsService(repo as never, settingsService as never, walletRepo as never);

    await expect(service.awardBid('need-1', 'bid-2', 'customer-1')).rejects.toMatchObject({
      code: 'AWARD_REPLACEMENT_BLOCKED',
    });
  });

  it('returns idempotent alreadyPaid response for duplicate pay call', async () => {
    queryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeNeed()] }) // need FOR UPDATE
      .mockResolvedValueOnce({
        rows: [makeBid({ paid_at: new Date().toISOString(), payment_transaction_id: 'tx-1' })],
      }) // bid FOR UPDATE
      .mockResolvedValueOnce({}); // COMMIT

    const settingsService = {
      getAppStatus: vi.fn().mockResolvedValue({ ...enabledNeedsStatus, moneyMovementsPaused: false }),
    };
    const walletRepo = {
      findByUserId: vi.fn(),
    };
    const repo = {};
    const service = new NeedsService(repo as never, settingsService as never, walletRepo as never);

    await expect(service.payBid('need-1', 'bid-1', 'customer-1')).resolves.toEqual({
      needId: 'need-1',
      bidId: 'bid-1',
      paid: true,
      alreadyPaid: true,
    });
    expect(walletRepo.findByUserId).not.toHaveBeenCalled();
  });

  it('rejects invalid need status transitions', async () => {
    const repo = {
      getNeedById: vi.fn().mockResolvedValue(makeNeed({ status: 'open' })),
      updateNeed: vi.fn(),
    };
    const settingsService = {
      getAppStatus: vi.fn().mockResolvedValue(enabledNeedsStatus),
    };
    const service = new NeedsService(repo as never, settingsService as never, {} as never);

    await expect(
      service.updateNeed('need-1', 'customer-1', { status: 'completed' }),
    ).rejects.toMatchObject({
      code: 'INVALID_NEED_STATUS_TRANSITION',
      statusCode: 400,
    });
    expect(repo.updateNeed).not.toHaveBeenCalled();
  });
});
