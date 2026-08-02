import { describe, expect, it } from 'vitest';

import { CONVERSATION_SUMMARY_FIELDS } from './chat.js';

describe('ConversationSummary public allowlist', () => {
  it('contains no authoritative contact or raw message field', () => {
    expect(CONVERSATION_SUMMARY_FIELDS).toEqual([
      'id',
      'status',
      'last_message_at',
      'created_at',
      'other_user_id',
      'other_display_name',
      'last_message_body',
      'has_unread',
    ]);

    const fields = CONVERSATION_SUMMARY_FIELDS.join(' ');
    expect(fields).not.toMatch(
      /email|phone|address|location|coordinate|payment|raw|attachment|link/,
    );
  });
});
