import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NeedsService } from '../modules/needs/needs.service.js';

// ---------------------------------------------------------------------------
// Per-bid contact gating for bid chat.
// ---------------------------------------------------------------------------
// The unlock condition used to be `needs.activated_at != null`, which is
// need-scoped: the moment ANY bid on a need was activated, every other bid
// thread unlocked too and handed the customer's contact details to providers
// who had paid nothing. These tests pin the per-bid behaviour.
// ---------------------------------------------------------------------------

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: vi.fn(), connect: vi.fn() }),
}));

const NEED_ID = 'need-1';
const WINNING_BID = 'bid-winner';
const LOSING_BID = 'bid-loser';
const CUSTOMER = 'customer-1';

const MESSAGES = [
  {
    id: 'm1',
    bid_id: WINNING_BID,
    sender_id: CUSTOMER,
    content: 'Call me on [contact hidden until activation]',
    raw_content: 'Call me on 01012345678',
    attachment_url: 'https://cdn.example/card.png',
    contact_redacted: true,
    created_at: new Date().toISOString(),
  },
];

/** Build a service whose gate reports the given per-bid activation state. */
function buildService(options: {
  activatedBids: string[];
  needActivated: boolean;
  gateEnabled?: boolean;
  bidOwner?: string;
  bidId?: string;
}) {
  const bidId = options.bidId ?? WINNING_BID;
  const repo = {
    getNeedById: vi.fn().mockResolvedValue({
      id: NEED_ID,
      customer_id: CUSTOMER,
      status: options.needActivated ? 'awarded' : 'awarded_pending_provider_acceptance',
      activated_at: options.needActivated ? new Date().toISOString() : null,
    }),
    getBidById: vi.fn().mockResolvedValue({
      id: bidId,
      need_id: NEED_ID,
      expert_id: options.bidOwner ?? 'provider-1',
    }),
    listBidMessages: vi.fn().mockResolvedValue(MESSAGES.map((m) => ({ ...m, bid_id: bidId }))),
    createBidMessage: vi.fn().mockResolvedValue({ id: 'new-message' }),
  };
  const settingsService = {
    getAppStatus: vi.fn().mockResolvedValue({ featureNeedsEnabled: true }),
  };
  const activationGate = {
    isGateEnabled: vi.fn().mockResolvedValue(options.gateEnabled ?? true),
    isAwardActivated: vi.fn((id: string) => Promise.resolve(options.activatedBids.includes(id))),
    isContactMaskingEnabled: vi.fn().mockResolvedValue(true),
    getAwardAcceptanceExpiryHours: vi.fn().mockResolvedValue(48),
  };

  const service = new NeedsService(
    repo as never,
    settingsService as never,
    {} as never,
    undefined as never,
    undefined as never,
    undefined as never,
    activationGate as never,
  );
  return { service, repo, activationGate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bid chat — per-bid unlocking', () => {
  it('reveals raw content on the bid that was actually activated', async () => {
    const { service } = buildService({ activatedBids: [WINNING_BID], needActivated: true });

    const messages = await service.listBidMessages(NEED_ID, WINNING_BID, CUSTOMER);
    expect(messages[0]).toMatchObject({
      content: 'Call me on 01012345678',
      contact_locked: false,
      thread_read_only: false,
    });
  });

  it('KEEPS a losing bid redacted even though the need is activated', async () => {
    // The regression this whole change exists for.
    const { service } = buildService({
      activatedBids: [WINNING_BID],
      needActivated: true,
      bidId: LOSING_BID,
    });

    const messages = await service.listBidMessages(NEED_ID, LOSING_BID, CUSTOMER);
    expect(messages[0]!.content).toBe('Call me on [contact hidden until activation]');
    expect(messages[0]).toMatchObject({ contact_locked: true, attachment_url: null });
    expect(messages[0]).not.toHaveProperty('raw_content');
  });

  it('marks a losing thread on an activated need as read-only', async () => {
    const { service } = buildService({
      activatedBids: [WINNING_BID],
      needActivated: true,
      bidId: LOSING_BID,
    });

    const messages = await service.listBidMessages(NEED_ID, LOSING_BID, CUSTOMER);
    expect(messages[0]!.thread_read_only).toBe(true);
  });

  it('does not mark a pre-activation thread read-only — negotiation is still open', async () => {
    const { service } = buildService({ activatedBids: [], needActivated: false });

    const messages = await service.listBidMessages(NEED_ID, WINNING_BID, CUSTOMER);
    expect(messages[0]).toMatchObject({ contact_locked: true, thread_read_only: false });
  });

  it('unlocks everything when an admin disables the gate', async () => {
    const { service } = buildService({
      activatedBids: [],
      needActivated: false,
      gateEnabled: false,
    });

    const messages = await service.listBidMessages(NEED_ID, WINNING_BID, CUSTOMER);
    expect(messages[0]).toMatchObject({ contact_locked: false });
  });

  it('never consults needs.activated_at to decide the unlock', async () => {
    const { service, activationGate } = buildService({
      activatedBids: [],
      needActivated: true,
      bidId: LOSING_BID,
    });

    const messages = await service.listBidMessages(NEED_ID, LOSING_BID, CUSTOMER);
    // Need is activated, but this bid is not — so it stays locked.
    expect(messages[0]!.contact_locked).toBe(true);
    expect(activationGate.isAwardActivated).toHaveBeenCalledWith(LOSING_BID);
  });
});

describe('bid chat — posting rules', () => {
  it('refuses new messages on a losing thread once the need is activated', async () => {
    const { service, repo } = buildService({
      activatedBids: [WINNING_BID],
      needActivated: true,
      bidId: LOSING_BID,
    });

    await expect(
      service.createBidMessage(NEED_ID, LOSING_BID, CUSTOMER, { content: 'still here?' }),
    ).rejects.toMatchObject({ code: 'BID_THREAD_ARCHIVED', statusCode: 403 });
    expect(repo.createBidMessage).not.toHaveBeenCalled();
  });

  it('allows unredacted messages on the activated bid', async () => {
    const { service, repo } = buildService({
      activatedBids: [WINNING_BID],
      needActivated: true,
    });

    await service.createBidMessage(NEED_ID, WINNING_BID, CUSTOMER, {
      content: 'My number is 01012345678',
    });
    expect(repo.createBidMessage).toHaveBeenCalledWith(
      WINNING_BID,
      CUSTOMER,
      'My number is 01012345678',
      null,
    );
  });

  it('redacts contact details before activation and keeps the original for moderation', async () => {
    const { service, repo } = buildService({ activatedBids: [], needActivated: false });

    await service.createBidMessage(NEED_ID, WINNING_BID, CUSTOMER, {
      content: 'reach me on 01012345678',
    });

    const call = repo.createBidMessage.mock.calls[0] as unknown[];
    expect(call[2]).not.toContain('01012345678');
    expect(call[3]).toBeNull();
    expect(call[4]).toMatchObject({ contactRedacted: true, rawContent: 'reach me on 01012345678' });
  });

  it('blocks attachments before activation', async () => {
    const { service, repo } = buildService({ activatedBids: [], needActivated: false });

    await expect(
      service.createBidMessage(NEED_ID, WINNING_BID, CUSTOMER, {
        content: 'see photo',
        attachmentUrl: 'https://cdn.example/card.png',
      }),
    ).rejects.toMatchObject({ code: 'ATTACHMENTS_LOCKED_UNTIL_ACTIVATION', statusCode: 403 });
    expect(repo.createBidMessage).not.toHaveBeenCalled();
  });

  it('rejects a viewer who is neither the customer nor the bidder', async () => {
    const { service } = buildService({ activatedBids: [WINNING_BID], needActivated: true });

    await expect(service.listBidMessages(NEED_ID, WINNING_BID, 'stranger')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });
});
