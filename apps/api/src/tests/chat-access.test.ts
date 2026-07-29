import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatService } from '../modules/chat/chat.service.js';

// ---------------------------------------------------------------------------
// General chat was the biggest hole in the MHC model: POST /chat/conversations
// accepted any otherUserId, with no relationship requirement and no redaction,
// so a provider could skip the gated bid thread and DM the customer instead.
// These tests pin decision D2 on BOTH the HTTP result and the object that gets
// broadcast over the socket.
// ---------------------------------------------------------------------------

const poolQueryMock = vi.fn();
vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: vi.fn() }),
}));

const CONVERSATION = {
  id: 'conv-1',
  participant_a: 'customer-1',
  participant_b: 'provider-1',
  status: 'open',
};

function build(access: { allowed: boolean; unlocked: boolean; reason?: string }) {
  const repo = {
    getConversation: vi.fn().mockResolvedValue(CONVERSATION),
    findOrCreateConversation: vi.fn().mockResolvedValue('conv-1'),
    getMessages: vi.fn().mockResolvedValue([
      {
        id: 'm1',
        conversation_id: 'conv-1',
        sender_id: 'provider-1',
        body: 'Reach me on [contact hidden until activation]',
        raw_content: 'Reach me on 01012345678',
        attachment_url: 'https://cdn.example/card.png',
        link_url: 'https://wa.me/201012345678',
        location_lat: 30.1,
        location_lng: 31.2,
        location_label: 'Home',
        contact_redacted: true,
      },
    ]),
    sendMessage: vi.fn((_c: string, _s: string, payload: Record<string, unknown>) =>
      Promise.resolve({
        id: 'm2',
        conversation_id: 'conv-1',
        sender_id: 'provider-1',
        ...payload,
        raw_content: payload.rawContent ?? null,
      }),
    ),
  };
  const settingsService = { getAppStatus: vi.fn().mockResolvedValue({ pauseChat: false }) };
  const notifications = { createForUser: vi.fn().mockResolvedValue(undefined) };
  const chatAccess = {
    resolveForPair: vi.fn().mockResolvedValue(access),
    resolveForConversation: vi.fn().mockResolvedValue(access),
    isMaskingEnabled: vi.fn().mockResolvedValue(true),
  };
  const service = new ChatService(
    repo as never,
    settingsService as never,
    notifications as never,
    chatAccess as never,
  );
  return { service, repo, chatAccess };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('starting a conversation', () => {
  it('refuses a cold DM with no shared job', async () => {
    const { service, repo } = build({ allowed: false, unlocked: false });

    await expect(service.startConversation('provider-1', 'customer-1')).rejects.toMatchObject({
      code: 'CHAT_REQUIRES_ACTIVE_JOB',
      statusCode: 403,
    });
    expect(repo.findOrCreateConversation).not.toHaveBeenCalled();
  });

  it('allows a conversation when the pair share an activated job', async () => {
    const { service, repo } = build({ allowed: true, unlocked: true, reason: 'activated_award' });

    await expect(service.startConversation('provider-1', 'customer-1')).resolves.toEqual({
      conversationId: 'conv-1',
    });
    expect(repo.findOrCreateConversation).toHaveBeenCalled();
  });

  it('allows support conversations', async () => {
    const { service } = build({ allowed: true, unlocked: true, reason: 'support' });
    await expect(service.startConversation('user-1', 'admin-1')).resolves.toBeTruthy();
  });
});

describe('reading messages', () => {
  it('redacts and strips every attachment channel while locked', async () => {
    const { service } = build({ allowed: true, unlocked: false, reason: 'reservation_pending' });

    const result = await service.getMessages('customer-1', 'conv-1');
    const message = result.messages[0] as Record<string, unknown>;

    expect(message.body).toBe('Reach me on [contact hidden until activation]');
    expect(message).not.toHaveProperty('raw_content');
    // A photo, a wa.me link and a pinned location each defeat text redaction.
    expect(message.attachment_url).toBeNull();
    expect(message.link_url).toBeNull();
    expect(message.location_lat).toBeNull();
    expect(message.location_lng).toBeNull();
    expect(result.contactLocked).toBe(true);
  });

  it('reveals the original text once the job is activated', async () => {
    const { service } = build({ allowed: true, unlocked: true, reason: 'activated_booking' });

    const result = await service.getMessages('customer-1', 'conv-1');
    const message = result.messages[0] as Record<string, unknown>;

    expect(message.body).toBe('Reach me on 01012345678');
    expect(message).not.toHaveProperty('raw_content');
    expect(result.contactLocked).toBe(false);
  });

  it('marks a conversation with no live reason as read-only rather than deleting it', async () => {
    const { service } = build({ allowed: false, unlocked: false });
    const result = await service.getMessages('customer-1', 'conv-1');
    expect(result.readOnly).toBe(true);
    expect(result.messages).toHaveLength(1);
  });
});

describe('sending messages', () => {
  it('redacts contact details and keeps the original for moderation', async () => {
    const { service, repo } = build({ allowed: true, unlocked: false });

    await service.sendMessage('provider-1', 'conv-1', {
      body: 'call me on 01012345678',
      messageType: 'text',
    } as never);

    const payload = repo.sendMessage.mock.calls[0]![2];
    expect(payload.body).not.toContain('01012345678');
    expect(payload.contactRedacted).toBe(true);
    expect(payload.rawContent).toBe('call me on 01012345678');
  });

  it.each([
    ['attachment', { attachmentUrl: 'https://cdn.example/card.png' }],
    ['link', { linkUrl: 'https://wa.me/201012345678' }],
    ['location', { lat: 30.1, lng: 31.2 }],
  ])('blocks a %s before activation', async (_label, extra) => {
    const { service, repo } = build({ allowed: true, unlocked: false });

    await expect(
      service.sendMessage('provider-1', 'conv-1', {
        body: 'see this',
        messageType: 'text',
        ...extra,
      } as never),
    ).rejects.toMatchObject({ code: 'ATTACHMENTS_LOCKED_UNTIL_ACTIVATION', statusCode: 403 });
    expect(repo.sendMessage).not.toHaveBeenCalled();
  });

  it('stores text verbatim once unlocked', async () => {
    const { service, repo } = build({ allowed: true, unlocked: true });

    await service.sendMessage('provider-1', 'conv-1', {
      body: 'call me on 01012345678',
      messageType: 'text',
    } as never);

    const payload = repo.sendMessage.mock.calls[0]![2];
    expect(payload.body).toBe('call me on 01012345678');
    expect(payload.contactRedacted).toBe(false);
    expect(payload.rawContent).toBeNull();
  });

  it('refuses to post to a conversation with no live reason', async () => {
    const { service, repo } = build({ allowed: false, unlocked: false });

    await expect(
      service.sendMessage('provider-1', 'conv-1', { body: 'hi', messageType: 'text' } as never),
    ).rejects.toMatchObject({ code: 'CHAT_REQUIRES_ACTIVE_JOB' });
    expect(repo.sendMessage).not.toHaveBeenCalled();
  });

  // The controller emits this exact object into the socket room. If it carried
  // raw_content, the socket would hand over what HTTP just redacted.
  it('returns a socket-safe object with no raw_content while locked', async () => {
    const { service } = build({ allowed: true, unlocked: false });

    const broadcast = (await service.sendMessage('provider-1', 'conv-1', {
      body: 'call me on 01012345678',
      messageType: 'text',
    } as never)) as unknown as Record<string, unknown>;

    expect(broadcast).not.toHaveProperty('raw_content');
    expect(String(broadcast.body)).not.toContain('01012345678');
    expect(broadcast.contact_locked).toBe(true);
    expect(broadcast.attachment_url).toBeNull();
  });
});
