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
  body: string;
  created_at: string;
  sender_name: string;
};

export class ChatRepository {
  async listConversations(userId: string): Promise<ConversationRow[]> {
    const { rows } = await getPool().query(
      `SELECT c.*,
        CASE WHEN c.participant_a = $1 THEN c.participant_b ELSE c.participant_a END AS other_user_id,
        COALESCE(u.display_name, u.email) AS other_display_name,
        u.email AS other_email,
        (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_body,
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
       ORDER BY m.created_at ASC
       LIMIT $2::int OFFSET $3::int`,
      [conversationId, limit, offset],
    );
    return rows as MessageRow[];
  }

  async sendMessage(conversationId: string, senderId: string, body: string): Promise<MessageRow> {
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *`,
      [conversationId, senderId, body],
    );
    await pool.query(
      `UPDATE conversations SET last_message_at = now(), updated_at = now() WHERE id = $1`,
      [conversationId],
    );
    const msg = rows[0] as MessageRow;
    msg.sender_name = '';
    return msg;
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
