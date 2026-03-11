import { getPool } from '../../db/pool.js';

export type ConversationRow = {
  id: string;
  participant_a: string;
  participant_b: string;
  status: string;
  last_message_at: string | null;
  created_at: string;
  other_user_id: string;
  other_display_name: string;
  other_email: string;
  last_message_body: string | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
  sender_name: string;
  reply_to_id: string | null;
  message_type: string;
  attachment_url: string | null;
  link_url: string | null;
  location_lat: string | null;
  location_lng: string | null;
  location_label: string | null;
  deleted_for_sender: boolean;
  deleted_for_everyone: boolean;
};

export class ChatRepository {
  async listConversations(userId: string): Promise<ConversationRow[]> {
    const { rows } = await getPool().query(
      `SELECT c.*,
        CASE WHEN c.participant_a = $1 THEN c.participant_b ELSE c.participant_a END AS other_user_id,
        COALESCE(u.display_name, u.email) AS other_display_name,
        u.email AS other_email,
        (SELECT CASE
          WHEN m.message_type = 'link' THEN COALESCE(NULLIF(TRIM(m.body), ''), '[Link]')
          WHEN m.message_type = 'location' THEN COALESCE(NULLIF(TRIM(m.location_label), ''), '[Location]')
          ELSE COALESCE(NULLIF(TRIM(m.body), ''), '[Media]')
        END FROM messages m
         WHERE m.conversation_id = c.id AND m.deleted_for_everyone = false
           AND (m.deleted_for_sender = false OR m.sender_id != $1)
         ORDER BY m.created_at DESC LIMIT 1) AS last_message_body,
        CASE WHEN c.participant_a = $1 THEN (c.last_message_at > c.participant_a_last_read_at) ELSE (c.last_message_at > c.participant_b_last_read_at) END AS has_unread
      FROM conversations c
      JOIN users u ON u.id = CASE WHEN c.participant_a = $1 THEN c.participant_b ELSE c.participant_a END
      WHERE c.participant_a = $1 OR c.participant_b = $1
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      [userId],
    );
    return rows as ConversationRow[];
  }

  async getConversation(convId: string): Promise<ConversationRow | null> {
    const { rows } = await getPool().query(
      `SELECT c.*, '' AS other_user_id, '' AS other_display_name, '' AS other_email, '' AS last_message_body
       FROM conversations c WHERE c.id = $1 LIMIT 1`,
      [convId],
    );
    return (rows[0] as ConversationRow) ?? null;
  }

  async getMessages(conversationId: string, limit = 50, offset = 0, userId?: string): Promise<MessageRow[]> {
    if (userId) {
      await getPool().query(
        `UPDATE conversations 
         SET participant_a_last_read_at = CASE WHEN participant_a = $1 THEN now() ELSE participant_a_last_read_at END,
             participant_b_last_read_at = CASE WHEN participant_b = $1 THEN now() ELSE participant_b_last_read_at END
         WHERE id = $2`,
        [userId, conversationId]
      );
    }
    const { rows } = await getPool().query(
      `SELECT m.*, COALESCE(u.display_name, u.email) AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
         AND m.deleted_for_everyone = false
         AND ($4::uuid IS NULL OR m.deleted_for_sender = false OR m.sender_id != $4)
       ORDER BY m.created_at ASC
       LIMIT $2::int OFFSET $3::int`,
      [conversationId, limit, offset, userId ?? null],
    );
    return rows as MessageRow[];
  }

  async findMessage(messageId: string, conversationId: string): Promise<MessageRow | null> {
    const { rows } = await getPool().query(
      `SELECT m.*, COALESCE(u.display_name, u.email) AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = $1 AND m.conversation_id = $2`,
      [messageId, conversationId],
    );
    return (rows[0] as MessageRow) ?? null;
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    payload: {
      body: string | null;
      replyToId?: string | null;
      messageType: string;
      attachmentUrl?: string | null;
      linkUrl?: string | null;
      locationLat?: number | null;
      locationLng?: number | null;
      locationLabel?: string | null;
    },
  ): Promise<MessageRow> {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO messages (
        conversation_id, sender_id, body, reply_to_id, message_type,
        attachment_url, link_url, location_lat, location_lng, location_label
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        conversationId,
        senderId,
        payload.body ?? '',
        payload.replyToId ?? null,
        payload.messageType ?? 'text',
        payload.attachmentUrl ?? null,
        payload.linkUrl ?? null,
        payload.locationLat ?? null,
        payload.locationLng ?? null,
        payload.locationLabel ?? null,
      ],
    );
    await pool.query(
      `UPDATE conversations SET last_message_at = now(), updated_at = now() WHERE id = $1`,
      [conversationId],
    );
    const msg = rows[0] as MessageRow;
    msg.sender_name = '';
    return msg;
  }

  async deleteForSender(messageId: string, userId: string): Promise<boolean> {
    const result = await getPool().query(
      `UPDATE messages SET deleted_for_sender = true WHERE id = $1 AND sender_id = $2`,
      [messageId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteForEveryone(messageId: string, senderId: string): Promise<boolean> {
    const result = await getPool().query(
      `UPDATE messages SET deleted_for_everyone = true WHERE id = $1 AND sender_id = $2`,
      [messageId, senderId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findOrCreateConversation(userA: string, userB: string): Promise<string> {
    const pool = getPool();
    const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
    const { rows: existing } = await pool.query(
      `SELECT id FROM conversations WHERE participant_a = $1 AND participant_b = $2 LIMIT 1`,
      [a, b],
    );
    if (existing.length > 0) return (existing[0] as { id: string }).id;

    const { rows: inserted } = await pool.query(
      `INSERT INTO conversations (participant_a, participant_b) VALUES ($1, $2)
       ON CONFLICT (participant_a, participant_b) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [a, b],
    );
    return (inserted[0] as { id: string }).id;
  }
}
