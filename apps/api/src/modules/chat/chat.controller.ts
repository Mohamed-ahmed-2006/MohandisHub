import type { ApiSuccessBody, ConversationSummary } from '@mohandishub/shared';

import { getSocketServer } from '../../lib/socket-instance.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ChatService } from './chat.service.js';
import { deleteMessageSchema, sendMessageSchema } from './chat.validation.js';

const chatService = new ChatService();

function parseBody<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

function parseQuery<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

const status = asyncHandler((_req, res) => {
  const message = chatService.getStatus();
  const response: ApiSuccessBody<{ message: string }> = { ok: true, data: { message } };
  res.status(200).json(response);
});

const listConversations = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  const conversations = await chatService.listConversations(user.id);
  const response: ApiSuccessBody<ConversationSummary[]> = { ok: true, data: conversations };
  res.json(response);
});

const getMessages = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  const { conversationId } = req.params;
  if (!conversationId)
    throw new HttpError({
      statusCode: 400,
      code: 'MISSING_ID',
      message: 'Conversation ID required.',
    });
  const result = await chatService.getMessages(user.id, conversationId);
  res.json({ ok: true, data: result });
});

const sendMessage = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  const { conversationId } = req.params;
  if (!conversationId)
    throw new HttpError({
      statusCode: 400,
      code: 'MISSING_ID',
      message: 'Conversation ID required.',
    });
  const input = parseBody(sendMessageSchema, req.body);
  const message = await chatService.sendMessage(user.id, conversationId, input);
  const io = getSocketServer();
  if (io) {
    io.to(`conversation:${conversationId}`).emit('new_message', message);
  }
  res.status(201).json({ ok: true, data: message });
});

const deleteMessage = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  const { conversationId, messageId } = req.params;
  if (!conversationId || !messageId)
    throw new HttpError({
      statusCode: 400,
      code: 'MISSING_ID',
      message: 'Conversation ID and message ID required.',
    });
  const { scope } = parseQuery(deleteMessageSchema, { scope: req.query.scope });
  const result = await chatService.deleteMessage(user.id, conversationId, messageId, scope);
  const io = getSocketServer();
  if (io) {
    io.to(`conversation:${conversationId}`).emit('message_deleted', {
      messageId,
      scope: result.scope,
    });
  }
  res.json({ ok: true, data: result });
});

const startConversation = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  const otherUserId = (req.body as { otherUserId?: string })?.otherUserId;
  if (!otherUserId)
    throw new HttpError({
      statusCode: 400,
      code: 'MISSING_USER',
      message: 'Other user ID required.',
    });
  const result = await chatService.startConversation(user.id, otherUserId);
  res.status(201).json({ ok: true, data: result });
});

export const chatController = {
  status,
  listConversations,
  getMessages,
  sendMessage,
  deleteMessage,
  startConversation,
};
