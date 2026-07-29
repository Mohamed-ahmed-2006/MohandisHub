import { redactContactDetails } from '../../utils/contact-redaction.js';
import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';

import { ChatAccessService } from './chat-access.service.js';
import { ChatRepository } from './chat.repository.js';
import type { SendMessageInput } from './chat.validation.js';

export class ChatService {
  constructor(
    private readonly repo: ChatRepository = new ChatRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly notificationsService: NotificationsService = new NotificationsService(),
    private readonly chatAccess: ChatAccessService = new ChatAccessService(),
  ) {}

  async listConversations(userId: string) {
    try {
      return await this.repo.listConversations(userId);
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
