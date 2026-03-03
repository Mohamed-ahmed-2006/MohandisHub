import type { ApiSuccessBody } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';

import { ServicesService } from './services.service.js';

const servicesService = new ServicesService();

const status = asyncHandler((_req, res) => {
  const message = servicesService.getStatus();
  const response: ApiSuccessBody<{ message: string }> = {
    ok: true,
    data: { message },
  };

  res.status(200).json(response);
});

export const servicesController = { status };
