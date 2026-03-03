import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';

import { ChatService } from './chat.service.js';

const chatService = new ChatService();

const status = asyncHandler((_req, res) => {
  const message = chatService.getStatus();
  const response: ApiSuccessBody<{ message: string }> = {
    ok: true,
    data: { message },
  };

  res.status(200).json(response);
});

export const chatController = { status };
