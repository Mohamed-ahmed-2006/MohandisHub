import { HttpError } from '../../utils/http-error.js';

import { ChatRepository } from './chat.repository.js';

export class ChatService {
  constructor(private readonly repo: ChatRepository = new ChatRepository()) {}

  async listConversations(userId: string) {
    return this.repo.listConversations(userId);
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
    return { messages: await this.repo.getMessages(conversationId), status: conv.status };
  }

  async sendMessage(userId: string, conversationId: string, body: string) {
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
    const convId = await this.repo.findOrCreateConversation(userId, otherUserId);
    return { conversationId: convId };
  }

  getStatus(): string {
    return 'Chat module active';
  }
}
