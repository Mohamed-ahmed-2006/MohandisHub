import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import { ChatRepository } from './chat.repository.js';

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

  async sendMessage(userId: string, conversationId: string, body: string) {
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
    return this.repo.sendMessage(conversationId, userId, body);
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
