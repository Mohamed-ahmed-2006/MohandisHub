import { CONVERSATION_SUMMARY_FIELDS } from '@mohandishub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatApiClient, parseConversationSummary } from '../lib/chat/client';

const API_ROW = {
  id: 'conversation-1',
  status: 'ongoing',
  last_message_at: '2026-08-02T10:00:00.000Z',
  created_at: '2026-08-01T10:00:00.000Z',
  other_user_id: 'provider-1',
  other_display_name: 'Provider Name',
  last_message_body: 'The drawings are ready.',
  has_unread: true,
};

describe('chat conversation-summary client contract', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retains only the shared allowlist from an API object', () => {
    const parsed = parseConversationSummary({
      ...API_ROW,
      other_email: 'provider@example.com',
      raw_content: 'Call 01012345678',
      attachment_url: '/api/upload/private/secret',
      location_lat: 30.0444,
    });

    expect(Object.keys(parsed).sort()).toEqual([...CONVERSATION_SUMMARY_FIELDS].sort());
    expect(JSON.stringify(parsed)).not.toContain('provider@example.com');
    expect(JSON.stringify(parsed)).not.toContain('01012345678');
    expect(JSON.stringify(parsed)).not.toContain('/api/upload/private/secret');
    expect(JSON.stringify(parsed)).not.toContain('30.0444');
  });

  it('does not retain an unexpected email returned by the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          await Promise.resolve();
          return {
            ok: true,
            data: [{ ...API_ROW, other_email: 'provider@example.com' }],
          };
        },
      }),
    );

    const result = await chatApiClient.listConversations('token');

    expect(result).toEqual([API_ROW]);
    expect(JSON.stringify(result)).not.toContain('provider@example.com');
  });
});
