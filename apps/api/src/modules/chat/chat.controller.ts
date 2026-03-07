import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ChatService } from './chat.service.js';

const chatService = new ChatService();

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
  res.json({ ok: true, data: conversations });
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
  const body = (req.body as { body?: string })?.body;
  if (!body || !body.trim())
    throw new HttpError({
      statusCode: 400,
      code: 'EMPTY_MESSAGE',
      message: 'Message body required.',
    });
  const message = await chatService.sendMessage(user.id, conversationId, body.trim());
  res.status(201).json({ ok: true, data: message });
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
  startConversation,
};
