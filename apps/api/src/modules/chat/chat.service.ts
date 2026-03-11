import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import { ChatRepository } from './chat.repository.js';
import type { SendMessageInput } from './chat.validation.js';

export class ChatService {
  constructor(
    private readonly repo: ChatRepository = new ChatRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
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
          message: 'Database schema is out of date. Please run migrations in the API folder: npm run migrate',
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
    return { messages: await this.repo.getMessages(conversationId, 50, 0, userId), status: conv.status };
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

    const body =
      input.messageType === 'link' || input.messageType === 'location'
        ? (input.body ?? '').trim() || null
        : (input.body ?? '').trim() || null;
    return this.repo.sendMessage(conversationId, userId, {
      body,
      replyToId: input.replyToId ?? null,
      messageType: input.messageType ?? 'text',
      attachmentUrl: input.attachmentUrl ?? null,
      linkUrl: input.linkUrl ?? null,
      locationLat: input.lat ?? null,
      locationLng: input.lng ?? null,
      locationLabel: input.label ?? null,
    });
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
    if (!ok) throw new HttpError({ statusCode: 404, code: 'MESSAGE_NOT_FOUND', message: 'Message not found.' });
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

    const convId = await this.repo.findOrCreateConversation(userId, otherUserId);
    return { conversationId: convId };
  }

  getStatus(): string {
    return 'Chat module active';
  }
}
