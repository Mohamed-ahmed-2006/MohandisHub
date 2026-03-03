import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';

import { WalletService } from './wallet.service.js';

const walletService = new WalletService();

const status = asyncHandler((_req, res) => {
  const message = walletService.getStatus();
  const response: ApiSuccessBody<{ message: string }> = {
    ok: true,
    data: { message },
  };

  res.status(200).json(response);
});

export const walletController = { status };
