import { CONVERSATION_SUMMARY_FIELDS } from '@mohandishub/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock, resolveForConversationMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  resolveForConversationMock: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  hasDatabaseConfig: () => false,
  getPool: () => ({
    query: poolQueryMock,
    connect: () => Promise.reject(new Error('Unexpected transaction in conversation-list test.')),
    on: () => undefined,
  }),
}));

vi.mock('../modules/chat/chat-access.service.js', () => ({
  ChatAccessService: vi.fn(function ChatAccessServiceMock() {
    return {
      resolveForConversation: resolveForConversationMock,
      resolveForPair: vi.fn(),
      isMaskingEnabled: vi.fn().mockResolvedValue(true),
    };
  }),
}));

import { createApp } from '../app.js';
import { signAccessToken } from '../config/jwt.js';
import { ChatRepository } from '../modules/chat/chat.repository.js';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

const bearer = (): string =>
  `Bearer ${signAccessToken({
    sub: CUSTOMER_ID,
    role: 'customer',
    isAdmin: false,
    verified: true,
    emailVerified: true,
  } as never)}`;

const summaryRow = (overrides: Record<string, unknown> = {}) => ({
  id: CONVERSATION_ID,
  participant_a: CUSTOMER_ID,
  participant_b: PROVIDER_ID,
  status: 'ongoing',
  last_message_at: '2026-08-02T10:00:00.000Z',
  created_at: '2026-08-01T10:00:00.000Z',
  other_user_id: PROVIDER_ID,
  other_display_name: 'Provider Name',
  last_message_body: 'Ordinary project update',
  last_message_raw_content: null,
  last_message_type: 'text',
  last_message_attachment_url: null,
  last_message_link_url: null,
  last_message_location_lat: null,
  last_message_location_lng: null,
  last_message_location_label: null,
  has_unread: true,
  ...overrides,
});

const list = async (row = summaryRow()) => {
  poolQueryMock.mockImplementation((sql: unknown) =>
    Promise.resolve(String(sql).includes('FROM conversations c') ? { rows: [row] } : { rows: [] }),
  );
  return request(createApp()).get('/api/chat/conversations').set('Authorization', bearer());
};

const responseItems = (body: unknown): Array<Record<string, unknown>> =>
  (body as { data: Array<Record<string, unknown>> }).data;

beforeEach(() => {
  poolQueryMock.mockReset();
  resolveForConversationMock.mockReset();
  resolveForConversationMock.mockResolvedValue({
    allowed: true,
    unlocked: false,
    reason: 'reservation_pending',
  });
});

describe('ChatRepository.listConversations', () => {
  it('does not query email or use email as a display-name fallback', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });

    await new ChatRepository().listConversations(CUSTOMER_ID);

    const sql = String(poolQueryMock.mock.calls[0]?.[0]);
    expect(sql).not.toMatch(/other_email/i);
    expect(sql).not.toMatch(/u\.email/i);
    expect(sql).toContain("COALESCE(NULLIF(BTRIM(u.display_name), ''), 'Member')");
  });
});

describe('GET /api/chat/conversations disclosure contract', () => {
  it('fails closed when conversation access cannot be resolved', async () => {
    resolveForConversationMock.mockRejectedValueOnce(new Error('activation lookup unavailable'));

    const response = await list(
      summaryRow({
        other_email: 'provider@example.com',
        last_message_body: 'Email provider@example.com',
      }),
    );

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('provider@example.com');
  });

  it('omits email from an accepted, unactivated reservation conversation', async () => {
    const response = await list(
      summaryRow({
        // Defence-in-depth regression: even an unexpected internal property is
        // excluded by the service's explicit serializer.
        other_email: 'provider@example.com',
        other_display_name: '',
      }),
    );

    expect(response.status).toBe(200);
    const item = responseItems(response.body)[0]!;
    expect(Object.keys(item).sort()).toEqual([...CONVERSATION_SUMMARY_FIELDS].sort());
    expect(item).not.toHaveProperty('other_email');
    expect(item.other_display_name).toBe('Member');
    expect(JSON.stringify(response.body)).not.toContain('provider@example.com');
  });

  it('keeps the public contract and ordinary metadata after activation', async () => {
    resolveForConversationMock.mockResolvedValueOnce({
      allowed: true,
      unlocked: true,
      reason: 'activated_booking',
    });
    const response = await list(
      summaryRow({
        other_email: 'provider@example.com',
        last_message_body: '[contact hidden until activation]',
        last_message_raw_content: 'Normal activated message',
      }),
    );

    const item = responseItems(response.body)[0]!;
    expect(item).toEqual({
      id: CONVERSATION_ID,
      status: 'ongoing',
      last_message_at: '2026-08-02T10:00:00.000Z',
      created_at: '2026-08-01T10:00:00.000Z',
      other_user_id: PROVIDER_ID,
      other_display_name: 'Provider Name',
      last_message_body: 'Normal activated message',
      has_unread: true,
    });
    expect(JSON.stringify(item)).not.toContain('provider@example.com');
  });

  it('re-redacts an unsafe historical text preview while locked', async () => {
    const unsafe =
      'Call 01012345678, email provider@example.com, WhatsApp https://wa.me/201012345678, use InstaPay handle provider-pay, site https://example.com, meet at 10 Tahrir Street';
    const response = await list(summaryRow({ last_message_body: unsafe }));

    const serialized = JSON.stringify(response.body);
    for (const protectedValue of [
      '01012345678',
      'provider@example.com',
      'wa.me/201012345678',
      'provider-pay',
      'https://example.com',
      '10 Tahrir Street',
    ]) {
      expect(serialized).not.toContain(protectedValue);
    }
    expect(responseItems(response.body)[0]!.last_message_body).toContain(
      '[contact hidden until activation]',
    );
  });

  it('keeps an ordinary locked text preview readable', async () => {
    const response = await list(summaryRow({ last_message_body: 'The drawings are ready.' }));
    expect(responseItems(response.body)[0]!.last_message_body).toBe('The drawings are ready.');
  });

  it.each([
    [
      'attachment',
      {
        last_message_type: 'image',
        last_message_body: 'Business card',
        last_message_attachment_url: '/api/upload/private/secret-file',
      },
      '[Media]',
    ],
    [
      'link',
      {
        last_message_type: 'link',
        last_message_body: 'https://wa.me/201012345678',
        last_message_link_url: 'https://wa.me/201012345678',
      },
      '[Link]',
    ],
    [
      'location',
      {
        last_message_type: 'location',
        last_message_body: 'Meet here',
        last_message_location_lat: '30.0444',
        last_message_location_lng: '31.2357',
        last_message_location_label: '10 Exact Street, Cairo',
      },
      '[Location]',
    ],
  ])('uses a safe generic label for a locked %s preview', async (_kind, overrides, label) => {
    const response = await list(summaryRow(overrides));
    const item = responseItems(response.body)[0]!;
    expect(item.last_message_body).toBe(label);
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('/api/upload/private/secret-file');
    expect(serialized).not.toContain('wa.me');
    expect(serialized).not.toContain('30.0444');
    expect(serialized).not.toContain('31.2357');
    expect(serialized).not.toContain('10 Exact Street');
  });
});
