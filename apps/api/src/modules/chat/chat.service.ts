import type { ConversationSummary } from '@mohandishub/shared';

import { redactContactDetails, REDACTION_MARKER } from '../../utils/contact-redaction.js';
import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';

import { ChatAccessService } from './chat-access.service.js';
import { ChatRepository, type ConversationSummaryRow } from './chat.repository.js';
import type { SendMessageInput } from './chat.validation.js';

/** Historical locked-text signals not covered by the general contact regex. */
const PAYMENT_INSTRUCTION_PATTERN =
  /\b(?:instapay|iban|bank\s+account|wallet\s+address|payment\s+handle|vodafone\s+cash|orange\s+cash|etisalat\s+cash)\b/i;

/** A conservative numbered-street shape; ordinary quantities remain readable. */
const EXACT_ADDRESS_PATTERN =
  /\b\d{1,5}\s+[\p{L}\p{N}.'-]+(?:\s+[\p{L}\p{N}.'-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd|building|apartment|unit)\b/iu;

export class ChatService {
  constructor(
    private readonly repo: ChatRepository = new ChatRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly notificationsService: NotificationsService = new NotificationsService(),
    private readonly chatAccess: ChatAccessService = new ChatAccessService(),
  ) {}

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    try {
      const rows = await this.repo.listConversations(userId);
      return await Promise.all(
        rows.map(async (row) => {
          const access = await this.chatAccess.resolveForConversation({
            conversationId: row.id,
            participantA: row.participant_a,
            participantB: row.participant_b,
          });
          return this.presentConversationSummary(row, access.unlocked);
        }),
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === '42703' || (pgErr.message?.includes('does not exist') ?? false)) {
        throw new HttpError({
          statusCode: 503,
          code: 'SCHEMA_OUTDATED',
          message:
            'Database schema is out of date. Please run migrations in the API folder: npm run migrate',
        });
      }
      throw err;
    }
  }

  /**
   * Serialize an internal repository row into the complete public allowlist.
   * Authorization-only participant fields and raw message values cannot cross
   * this boundary because they are never copied into the returned object.
   */
  private presentConversationSummary(
    row: ConversationSummaryRow,
    unlocked: boolean,
  ): ConversationSummary {
    return {
      id: row.id,
      status: row.status,
      last_message_at: row.last_message_at,
      created_at: row.created_at,
      other_user_id: row.other_user_id,
      other_display_name: row.other_display_name.trim() || 'Member',
      last_message_body: this.presentConversationPreview(row, unlocked),
      has_unread: row.has_unread === true,
    };
  }

  /**
   * Apply the same unlock decision used by individual message presentation.
   *
   * Locked historical text is redacted again even when its stored row predates
   * the redaction columns. Non-text channels become generic labels, so their
   * URL, path, coordinates, or exact location label never becomes a preview.
   */
  private presentConversationPreview(
    row: ConversationSummaryRow,
    unlocked: boolean,
  ): string | null {
    if (!row.last_message_type) return null;

    if (!unlocked) {
      if (
        row.last_message_type === 'location' ||
        row.last_message_location_lat != null ||
        row.last_message_location_lng != null ||
        row.last_message_location_label != null
      ) {
        return '[Location]';
      }
      if (row.last_message_type === 'link' || row.last_message_link_url != null) {
        return '[Link]';
      }
      if (
        row.last_message_type === 'image' ||
        row.last_message_type === 'voice' ||
        row.last_message_attachment_url != null
      ) {
        return '[Media]';
      }

      return this.presentLockedText(row.last_message_body);
    }

    const revealedBody = (row.last_message_raw_content ?? row.last_message_body)?.trim() ?? '';
    if (row.last_message_type === 'link') return revealedBody || '[Link]';
    if (row.last_message_type === 'location') {
      return row.last_message_location_label?.trim() || '[Location]';
    }
    return revealedBody || '[Media]';
  }

  private presentLockedText(value: unknown): string | null {
    const storedBody = typeof value === 'string' ? value.trim() : '';
    if (!storedBody) return null;
    if (PAYMENT_INSTRUCTION_PATTERN.test(storedBody) || EXACT_ADDRESS_PATTERN.test(storedBody)) {
      return REDACTION_MARKER;
    }
    return redactContactDetails(storedBody).content || null;
  }

  async getMessages(userId: string, conversationId: string) {
    const conv = await this.repo.getConversation(conversationId);
    if (!conv) {
      throw new HttpError({
        statusCode: 404,
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found.',
      });
    }
    if (conv.participant_a !== userId && conv.participant_b !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not a participant.' });
    }

    const access = await this.chatAccess.resolveForConversation({
      conversationId,
      participantA: conv.participant_a,
      participantB: conv.participant_b,
    });
    const messages = await this.repo.getMessages(conversationId, 50, 0, userId);

    return {
      messages: messages.map((m) => this.presentMessage(m, access.unlocked)),
      status: conv.status,
      contactLocked: !access.unlocked,
      // A conversation that lost its reason to exist stays readable but closed.
      readOnly: !access.allowed,
    };
  }

  /**
   * Shape a stored message for a reader.
   *
   * Unlocked: reveal `raw_content`, the text as typed. Locked: serve the
   * redacted `body`, drop `raw_content` entirely, and strip every attachment
   * channel — an image of a business card, a link, or a pinned location all
   * defeat text redaction.
   */
  private presentMessage(message: Record<string, unknown>, unlocked: boolean) {
    if (unlocked) {
      const { raw_content: raw, ...rest } = message;
      return {
        ...rest,
        body: (raw as string | null) ?? (message.body as string | null),
        contact_locked: false,
      };
    }
    const { raw_content: _raw, ...rest } = message;
    return {
      ...rest,
      body: this.presentLockedText(message.body),
      attachment_url: null,
      link_url: null,
      location_lat: null,
      location_lng: null,
      location_label: null,
      contact_locked: true,
    };
  }

  async sendMessage(userId: string, conversationId: string, input: SendMessageInput) {
    const status = await this.settingsService.getAppStatus();
    if (status.pauseChat) {
      throw new HttpError({
        statusCode: 503,
        code: 'CHAT_PAUSED',
        message: 'Chat is temporarily disabled.',
      });
    }

    const conv = await this.repo.getConversation(conversationId);
    if (!conv) {
      throw new HttpError({
        statusCode: 404,
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found.',
      });
    }
    if (conv.participant_a !== userId && conv.participant_b !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not a participant.' });
    }
    if (conv.status === 'closed') {
      throw new HttpError({
        statusCode: 400,
        code: 'CONVERSATION_CLOSED',
        message: 'This conversation is closed.',
      });
    }

    const access = await this.chatAccess.resolveForConversation({
      conversationId,
      participantA: conv.participant_a,
      participantB: conv.participant_b,
    });

    // No live reason for this conversation: readable, but closed to new
    // messages. Deleting history would destroy the moderation trail.
    if (!access.allowed) {
      throw new HttpError({
        statusCode: 403,
        code: 'CHAT_REQUIRES_ACTIVE_JOB',
        message:
          'This conversation is closed because you have no active job together. Use the chat on the relevant request or booking.',
      });
    }

    const rawBody = (input.body ?? '').trim() || null;
    const recipientId = conv.participant_a === userId ? conv.participant_b : conv.participant_a;

    let body = rawBody;
    let contactRedacted = false;
    let rawContent: string | null = null;
    let attachmentUrl = input.attachmentUrl ?? null;
    let linkUrl = input.linkUrl ?? null;
    let lat = input.lat ?? null;
    let lng = input.lng ?? null;
    let label = input.label ?? null;
    let messageType = input.messageType ?? 'text';

    if (!access.unlocked) {
      // Attachments, links and pinned locations are blocked outright before
      // activation: each is a complete bypass of text redaction.
      if (attachmentUrl || linkUrl || lat != null || lng != null) {
        throw new HttpError({
          statusCode: 403,
          code: 'ATTACHMENTS_LOCKED_UNTIL_ACTIVATION',
          message:
            'Attachments, links and locations unlock once the job is activated. Please describe it in text for now.',
        });
      }
      attachmentUrl = null;
      linkUrl = null;
      lat = null;
      lng = null;
      label = null;
      messageType = 'text';

      if (await this.chatAccess.isMaskingEnabled()) {
        const result = redactContactDetails(rawBody ?? '');
        body = result.content || null;
        contactRedacted = result.redacted;
        // Keep the original for moderation and for reveal after activation.
        rawContent = rawBody;
      }
    }

    const saved = await this.repo.sendMessage(conversationId, userId, {
      body,
      replyToId: input.replyToId ?? null,
      messageType,
      attachmentUrl,
      linkUrl,
      locationLat: lat,
      locationLng: lng,
      locationLabel: label,
      contactRedacted,
      rawContent,
    });
    const preview =
      body && body.length > 0
        ? body.length > 120
          ? `${body.slice(0, 117)}...`
          : body
        : input.attachmentUrl
          ? 'Sent an attachment'
          : input.messageType === 'location'
            ? 'Shared a location'
            : input.messageType === 'link'
              ? 'Shared a link'
              : 'New message';
    void this.notificationsService
      .createForUser(recipientId, {
        type: 'chat_message',
        title: 'New message',
        message: preview,
        payload: { conversationId, messageId: saved.id },
      })
      .catch(() => {});

    // The controller broadcasts this exact object over the socket room. Returning
    // the raw row would leak `raw_content` to every socket listener — the socket
    // path must redact identically to the HTTP path, or it simply becomes the
    // next bypass.
    return this.presentMessage(saved as unknown as Record<string, unknown>, access.unlocked);
  }

  async deleteMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    scope: 'for_me' | 'for_everyone',
  ) {
    const conv = await this.repo.getConversation(conversationId);
    if (!conv) {
      throw new HttpError({
        statusCode: 404,
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found.',
      });
    }
    if (conv.participant_a !== userId && conv.participant_b !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not a participant.' });
    }

    const msg = await this.repo.findMessage(messageId, conversationId);
    if (!msg) {
      throw new HttpError({
        statusCode: 404,
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found.',
      });
    }

    if (scope === 'for_me') {
      const ok = await this.repo.deleteForSender(messageId, userId);
      if (!ok) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Can only delete your own messages for yourself.',
        });
      }
      return { deleted: true, scope: 'for_me' as const };
    }

    if (msg.sender_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only the sender can delete for everyone.',
      });
    }
    const ok = await this.repo.deleteForEveryone(messageId, userId);
    if (!ok)
      throw new HttpError({
        statusCode: 404,
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found.',
      });
    return { deleted: true, scope: 'for_everyone' as const };
  }

  async startConversation(userId: string, otherUserId: string) {
    const status = await this.settingsService.getAppStatus();
    if (status.pauseChat) {
      throw new HttpError({
        statusCode: 503,
        code: 'CHAT_PAUSED',
        message: 'Chat is temporarily disabled.',
      });
    }

    // Decision D2. Arbitrary direct messaging is what made every bid-chat
    // protection pointless: a provider could skip the gated thread entirely and
    // DM the customer. A conversation now needs a reason to exist.
    const access = await this.chatAccess.resolveForPair(userId, otherUserId);
    if (!access.allowed) {
      throw new HttpError({
        statusCode: 403,
        code: 'CHAT_REQUIRES_ACTIVE_JOB',
        message:
          'You can message this person once you have an active job together. Until then, use the chat on the relevant request or booking.',
      });
    }

    const convId = await this.repo.findOrCreateConversation(userId, otherUserId);
    return { conversationId: convId };
  }

  getStatus(): string {
    return 'Chat module active';
  }
}
