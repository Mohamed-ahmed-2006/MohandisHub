// ---------------------------------------------------------------------------
// Services controller — public HTTP handlers
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, Service, ServiceCategory } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';

import { ServicesService } from './services.service.js';

const servicesService = new ServicesService();

const listCategories = asyncHandler(async (_req, res) => {
  const categories = await servicesService.listCategories();
  const response: ApiSuccessBody<ServiceCategory[]> = { ok: true, data: categories };
  res.json(response);
});

const searchServices = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const filters: {
    categoryId?: string;
    city?: string;
    area?: string;
    providerType?: string;
    query?: string;
  } = {};
  if (req.query.categoryId) filters.categoryId = req.query.categoryId as string;
  if (req.query.city) filters.city = req.query.city as string;
  if (req.query.area) filters.area = req.query.area as string;
  if (req.query.providerType) filters.providerType = req.query.providerType as string;
  if (req.query.q) filters.query = req.query.q as string;

  const result = await servicesService.searchServices(filters, page, limit);
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.json(response);
});

const getServiceDetail = asyncHandler(async (req, res) => {
  const service = await servicesService.getServiceDetail(req.params.id!);
  const response: ApiSuccessBody<Service> = { ok: true, data: service };
  res.json(response);
});

export const servicesController = { listCategories, searchServices, getServiceDetail };
