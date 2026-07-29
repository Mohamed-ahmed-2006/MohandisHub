// ---------------------------------------------------------------------------
// MHC (Mohandis Credits) controller — HTTP handlers
// ---------------------------------------------------------------------------

import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { MhcService } from './mhc.service.js';

const mhcService = new MhcService();

function getUser(req: { user?: { id: string; role: string } }): { id: string; role: string } {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

/** Query params can be arrays/objects; only accept plain scalar strings. */
function queryString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function parsePagination(req: Request): { page: number; limit: number } {
  const pageRaw = Number.parseInt(queryString(req.query.page) ?? '1', 10);
  const limitRaw = Number.parseInt(queryString(req.query.limit) ?? '20', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  return { page, limit };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: `${field} is required.`,
    });
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireNumber(value: unknown, field: string): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(parsed)) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: `${field} must be a number.`,
    });
  }
  return parsed;
}

export const mhcController = {
  // -------------------------------------------------------------------------
  // Provider endpoints
  // -------------------------------------------------------------------------
  getMyCredits: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await mhcService.getMyCredits({ userId: user.id, role: user.role });
    res.json({ success: true, data });
  }),

  getMyCreditTransactions: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const { page, limit } = parsePagination(req);
    const result = await mhcService.listMyCreditTransactions({
      userId: user.id,
      role: user.role,
      page,
      limit,
    });
    res.json({
      success: true,
      data: result.rows,
      meta: { page, limit, total: result.total },
    });
  }),

  getPackages: asyncHandler(async (_req: Request, res: Response) => {
    const data = await mhcService.listPackages();
    res.json({ success: true, data });
  }),

  getActionPrices: asyncHandler(async (_req: Request, res: Response) => {
    const data = await mhcService.listActionPrices();
    res.json({ success: true, data });
  }),

  getInstapayPurchaseInfo: asyncHandler(async (_req: Request, res: Response) => {
    const [account, packages] = await Promise.all([
      mhcService.getInstapayCollectionAccount(),
      mhcService.listPackages(),
    ]);
    res.json({ success: true, data: { destinationAccount: account, packages } });
  }),

  submitInstapayPurchase: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await mhcService.submitInstapayCreditPurchase({
      userId: user.id,
      role: user.role,
      packageId: requireString(body.packageId, 'packageId'),
      proofUploadId: requireString(body.proofUploadId, 'proofUploadId'),
      transferReference: requireString(body.transferReference, 'transferReference'),
    });
    res.status(201).json({ success: true, data: result });
  }),

  /** Start an automated crypto purchase; returns the hosted checkout URL. */
  createNowPaymentsPurchase: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await mhcService.createNowPaymentsCreditPurchase({
      userId: user.id,
      role: user.role,
      packageId: requireString(body.packageId, 'packageId'),
      payCurrency: optionalString(body.payCurrency),
    });
    res.status(201).json({ success: true, data: result });
  }),

  /**
   * NOWPayments IPN. Mounted with a raw body parser so the HMAC can be checked
   * against the exact bytes received.
   *
   * Always answers 200 once the signature is valid, even when nothing is
   * credited: NOWPayments retries non-2xx, and retrying a callback we have
   * deliberately parked for review would achieve nothing. An invalid signature
   * still returns 400.
   */
  nowPaymentsIpn: asyncHandler(async (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
    const signature = String(req.header('x-nowpayments-sig') ?? '');
    const result = await mhcService.handleNowPaymentsCreditIpn(raw, signature);
    res.json({ success: true, data: result });
  }),

  getMyCreditPurchases: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const { page, limit } = parsePagination(req);
    const result = await mhcService.listMyCreditPurchases({
      userId: user.id,
      role: user.role,
      page,
      limit,
    });
    res.json({ success: true, data: result.rows, meta: { page, limit, total: result.total } });
  }),

  /** Provider accepts a pending award and pays MHC to unlock the job. */
  activateAward: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await mhcService.activateAwardForProvider({
      userId: user.id,
      role: user.role,
      bidId: requireString(req.params.bidId, 'bidId'),
    });
    res.json({ success: true, data });
  }),

  /** Provider declines a pending award. No credits are charged. */
  rejectAward: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await mhcService.rejectAwardForProvider({
      userId: user.id,
      role: user.role,
      bidId: requireString(req.params.bidId, 'bidId'),
    });
    res.json({ success: true, data });
  }),

  /** Customer withdraws an award the provider has not accepted yet. */
  withdrawAward: asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const data = await mhcService.withdrawAwardForCustomer({
      userId: user.id,
      needId: requireString(req.params.needId, 'needId'),
    });
    res.json({ success: true, data });
  }),

  /** Check whether an award is already unlocked (drives UI gating). */
  getAwardActivationStatus: asyncHandler(async (req: Request, res: Response) => {
    getUser(req);
    const bidId = requireString(req.params.bidId, 'bidId');
    const [activated, price] = await Promise.all([
      mhcService.isActivated({ activationType: 'award', bidId }),
      mhcService.getEffectivePrice('award_activation'),
    ]);
    res.json({ success: true, data: { activated, requiredMhc: price } });
  }),

  // -------------------------------------------------------------------------
  // Admin endpoints
  // -------------------------------------------------------------------------

  adminListPurchases: asyncHandler(async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req);
    const status = optionalString(req.query.status);
    const result = await mhcService.listPurchasesForAdmin({
      ...(status ? { status } : {}),
      page,
      limit,
    });
    res.json({
      success: true,
      data: result.rows,
      meta: { page, limit, total: result.total },
    });
  }),

  adminApprovePurchase: asyncHandler(async (req: Request, res: Response) => {
    const admin = getUser(req);
    const purchaseId = requireString(req.params.id, 'id');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const override =
      body.overrideMhcAmount != null
        ? requireNumber(body.overrideMhcAmount, 'overrideMhcAmount')
        : null;
    const data = await mhcService.approvePurchase({
      purchaseId,
      adminId: admin.id,
      overrideMhcAmount: override,
    });
    res.json({ success: true, data });
  }),

  adminRejectPurchase: asyncHandler(async (req: Request, res: Response) => {
    const admin = getUser(req);
    const purchaseId = requireString(req.params.id, 'id');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await mhcService.rejectPurchase({
      purchaseId,
      adminId: admin.id,
      reason: requireString(body.reason, 'reason'),
    });
    res.json({ success: true, data });
  }),

  adminListPackages: asyncHandler(async (_req: Request, res: Response) => {
    const data = await mhcService.listAllPackagesForAdmin();
    res.json({ success: true, data });
  }),

  adminUpsertPackage: asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await mhcService.upsertPackage({
      code: requireString(body.code, 'code'),
      name: requireString(body.name, 'name'),
      nameAr: optionalString(body.nameAr),
      mhcAmount: requireNumber(body.mhcAmount, 'mhcAmount'),
      externalPriceAmount: requireNumber(body.externalPriceAmount, 'externalPriceAmount'),
      ...(typeof body.externalPriceCurrency === 'string'
        ? { externalPriceCurrency: body.externalPriceCurrency }
        : {}),
      isActive: body.isActive !== false,
      ...(body.sortOrder != null ? { sortOrder: requireNumber(body.sortOrder, 'sortOrder') } : {}),
    });
    res.json({ success: true, data });
  }),

  adminUpsertActionPrice: asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await mhcService.upsertActionPrice({
      actionKey: requireString(body.actionKey, 'actionKey'),
      name: requireString(body.name, 'name'),
      mhcPrice: requireNumber(body.mhcPrice, 'mhcPrice'),
      isActive: body.isActive !== false,
    });
    res.json({ success: true, data });
  }),
};
