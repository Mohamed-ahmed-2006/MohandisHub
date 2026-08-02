/**
 * The complete public contract for one row in GET /api/chat/conversations.
 *
 * Keep this deliberately small. Conversation repository rows contain participant
 * and message data used to make authorization decisions, but only these fields
 * are allowed to cross the API boundary.
 */
export type ConversationSummary = {
  id: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  other_user_id: string;
  other_display_name: string;
  last_message_body: string | null;
  has_unread: boolean;
};

/** Runtime allowlist used by contract tests and boundary serializers. */
export const CONVERSATION_SUMMARY_FIELDS = [
  'id',
  'status',
  'last_message_at',
  'created_at',
  'other_user_id',
  'other_display_name',
  'last_message_body',
  'has_unread',
] as const satisfies readonly (keyof ConversationSummary)[];
