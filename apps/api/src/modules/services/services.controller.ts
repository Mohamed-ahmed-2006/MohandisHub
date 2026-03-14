// ---------------------------------------------------------------------------
// Services controller — public and provider HTTP handlers
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, Service, ServiceCategory } from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ServicesService } from './services.service.js';
import {
  createServiceSchema,
  updateServiceSchema,
} from './services.validation.js';

const servicesService = new ServicesService();

function requireUser(req: { user?: { id: string; role?: string } }) {
  if (!req.user)
    throw new HttpError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Auth required.' });
  return req.user;
}

function parseBody<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { flatten: () => { fieldErrors: unknown } };
    };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid input.',
      details: result.error!.flatten().fieldErrors,
    });
  }
  return result.data as T;
}

const getRecommendations = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 20);
  const categoryId = req.query.categoryId as string | undefined;
  const items = await servicesService.getRecommendedServices(limit, categoryId);
  res.json({ ok: true, data: { items } });
});

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
    minRating?: number;
    minPrice?: number;
    maxPrice?: number;
    verifiedOnly?: boolean;
    sort?: string;
  } = {};
  if (req.query.categoryId) filters.categoryId = req.query.categoryId as string;
  if (req.query.city) filters.city = req.query.city as string;
  if (req.query.area) filters.area = req.query.area as string;
  if (req.query.providerType) filters.providerType = req.query.providerType as string;
  if (req.query.q) filters.query = req.query.q as string;
  const minRatingNum = parseInt(req.query.minRating as string, 10);
  if (!Number.isNaN(minRatingNum) && minRatingNum >= 0) filters.minRating = minRatingNum;
  const minPriceNum = parseFloat(req.query.minPrice as string);
  if (!Number.isNaN(minPriceNum) && minPriceNum >= 0) filters.minPrice = minPriceNum;
  const maxPriceNum = parseFloat(req.query.maxPrice as string);
  if (!Number.isNaN(maxPriceNum) && maxPriceNum >= 0) filters.maxPrice = maxPriceNum;
  if (req.query.verifiedOnly === 'true') filters.verifiedOnly = true;
  if (req.query.sort && typeof req.query.sort === 'string') filters.sort = req.query.sort;

  const result = await servicesService.searchServices(filters, page, limit);
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.json(response);
});

const getServiceDetail = asyncHandler(async (req, res) => {
  const service = await servicesService.getServiceDetail(req.params.id!);
  const response: ApiSuccessBody<Service> = { ok: true, data: service };
  res.json(response);
});

const createService = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(createServiceSchema, req.body);
  const service = await servicesService.createService(user.id, input);
  res.status(201).json({ ok: true, data: service });
});

const listMyServices = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const result = await servicesService.listMyServices(user.id, page, limit);
  res.json({ ok: true, data: result });
});

const updateService = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const input = parseBody(updateServiceSchema, req.body);
  const service = await servicesService.updateService(req.params.id!, user.id, input);
  res.json({ ok: true, data: service });
});

const submitService = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const service = await servicesService.submitService(req.params.id!, user.id);
  res.json({ ok: true, data: service });
});

const pauseService = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const service = await servicesService.pauseService(req.params.id!, user.id);
  res.json({ ok: true, data: service });
});

const activateService = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const service = await servicesService.activateService(req.params.id!, user.id);
  res.json({ ok: true, data: service });
});

export const servicesController = {
  listCategories,
  getRecommendations,
  searchServices,
  getServiceDetail,
  createService,
  listMyServices,
  updateService,
  submitService,
  pauseService,
  activateService,
};
