// ---------------------------------------------------------------------------
// Business workspace routes.
// ---------------------------------------------------------------------------
// Deliberately thin. Every route parses its input and calls the service; not one
// of them decides who is allowed to do anything. Authorization lives in
// `business-teams.authorization.ts` and is applied inside the service, so a new
// route cannot be added that forgets it, and no two routes can drift into
// subtly different rules.
//
// Two of these routes are reachable without a signed-in account:
//
//   * the invitation preview, because the recipient has to be able to see what
//     they were invited to before deciding whether to create an account. It is
//     rate limited and returns only what the shared `BusinessInvitePreview`
//     allows;
//   * nothing else.
//
// Everything else requires a verified, authenticated account. Note that team
// routes deliberately do NOT sit behind `requireRole('business')`: workspace
// membership is independent of the primary account role, and an invited expert
// or craftsman is a legitimate member of a business workspace.
// ---------------------------------------------------------------------------

import type {
  BusinessTeamPermission,
  CreateBusinessInviteBody,
  CreateBusinessRoleBody,
  DeleteBusinessRoleBody,
  TransferBusinessOwnershipBody,
  UpdateBusinessMemberRoleBody,
} from '@mohandishub/shared';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import { authenticate } from '../../middleware/authenticate.js';
import { invitePreviewRateLimiter } from '../../middleware/rate-limit.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ALL_BUSINESS_TEAM_PERMISSIONS } from './business-teams.constants.js';
import * as service from './business-teams.service.js';

const router = Router();

const permissionSchema = z.enum(
  ALL_BUSINESS_TEAM_PERMISSIONS as unknown as [BusinessTeamPermission, ...BusinessTeamPermission[]],
);

const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  permissions: z.array(permissionSchema).default([]),
});

const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  roleId: z.string().uuid(),
});

const deleteRoleSchema = z.object({
  replacementRoleId: z.string().uuid(),
});

const memberRoleSchema = z.object({
  roleId: z.string().uuid(),
});

const transferSchema = z.object({
  memberId: z.string().uuid(),
  confirmation: z.string().min(1).max(200),
});

/**
 * A base64url token of 32 random bytes is 43 characters. The bound is generous
 * on both sides so an older hex token still parses, and narrow enough that the
 * endpoint is not a place to post arbitrary strings.
 */
const tokenSchema = z
  .string()
  .min(20)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid invitation token.');

const acceptSchema = z.object({ token: tokenSchema });

const parse = <Out>(
  schema: z.ZodType<Out, z.ZodTypeDef, unknown>,
  value: unknown,
  message: string,
): Out => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message,
      details: parsed.error.flatten().fieldErrors,
    });
  }
  return parsed.data;
};

/**
 * Path identifiers are UUIDs everywhere in this module.
 *
 * Checked before the value reaches a query so a hand-typed id is a 400 rather
 * than a 22P02 from PostgreSQL surfacing as a 500.
 */
const uuidParam = (value: string | undefined, code: string, message: string): string => {
  if (!value || !z.string().uuid().safeParse(value).success) {
    throw new HttpError({ statusCode: 404, code, message });
  }
  return value;
};

const actorOf = (req: { user?: { id: string; role?: string } }): service.Actor => {
  if (!req.user?.id) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return { id: req.user.id, ...(req.user.role !== undefined && { role: req.user.role }) };
};

// ---------------------------------------------------------------------------
// Invitation preview — the only route that does not require authentication.
// ---------------------------------------------------------------------------
// `authenticate` is applied optionally: a signed-in visitor gets the
// account-match answer, an anonymous one is told that signing in is required.
// A bad or absent Authorization header is not an error here, it is simply an
// anonymous request.

const optionalAuthenticate: RequestHandler = (req, res, next) => {
  if (!req.headers.authorization) {
    next();
    return;
  }
  authenticate(req, res, (err?: unknown) => {
    // An expired or malformed token on a public page is an anonymous visitor,
    // not a 401 — the preview simply reports that signing in is required.
    if (err) delete req.user;
    next();
  });
};

router.get(
  '/invites/preview',
  // The preview takes a token from the URL, so it is the one place in this
  // module where guessing is even conceivable. Rate limited on top of a
  // 256-bit token space.
  invitePreviewRateLimiter,
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const parsed = tokenSchema.safeParse(token);
    if (!parsed.success) {
      // A malformed token and an unknown token get the same answer, so the shape
      // of the response never confirms that a token exists.
      res.json({
        ok: true,
        data: {
          state: 'malformed',
          teamName: null,
          inviterDisplayName: null,
          maskedEmail: null,
          roleName: null,
          expiresAt: null,
          requiresAuthentication: req.user?.id === undefined,
          signedInAccountMatches: null,
        },
      });
      return;
    }
    res.json({
      ok: true,
      data: await service.previewInvite({ token: parsed.data, viewerId: req.user?.id }),
    });
  }),
);

// ---------------------------------------------------------------------------
// Everything below requires a verified, authenticated account.
// ---------------------------------------------------------------------------

router.use(authenticate, requireEmailVerified);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await service.getOverview(actorOf(req)) });
  }),
);

router.post(
  '/roles',
  asyncHandler(async (req, res) => {
    const body = parse(roleSchema, req.body satisfies CreateBusinessRoleBody, 'Invalid role.');
    res.status(201).json({ ok: true, data: await service.createRole(actorOf(req), body) });
  }),
);

router.patch(
  '/roles/:roleId',
  asyncHandler(async (req, res) => {
    const body = parse(roleSchema, req.body satisfies CreateBusinessRoleBody, 'Invalid role.');
    res.json({
      ok: true,
      data: await service.updateRole(
        actorOf(req),
        uuidParam(req.params.roleId, 'ROLE_NOT_FOUND', 'Custom role not found in this workspace.'),
        body,
      ),
    });
  }),
);

router.delete(
  '/roles/:roleId',
  asyncHandler(async (req, res) => {
    const body = parse(
      deleteRoleSchema,
      req.body satisfies DeleteBusinessRoleBody,
      'Replacement role is required.',
    );
    res.json({
      ok: true,
      data: await service.deleteRole(
        actorOf(req),
        uuidParam(req.params.roleId, 'ROLE_NOT_FOUND', 'Custom role not found in this workspace.'),
        body,
      ),
    });
  }),
);

router.post(
  '/invites',
  asyncHandler(async (req, res) => {
    const body = parse(
      inviteSchema,
      req.body satisfies CreateBusinessInviteBody,
      'Invalid invite.',
    );
    res.status(201).json({ ok: true, data: await service.createInvite(actorOf(req), body) });
  }),
);

router.post(
  '/invites/:inviteId/revoke',
  asyncHandler(async (req, res) => {
    res.json({
      ok: true,
      data: await service.revokeInvite(
        actorOf(req),
        uuidParam(
          req.params.inviteId,
          'INVITE_NOT_FOUND',
          'Invitation not found in this workspace.',
        ),
      ),
    });
  }),
);

router.post(
  '/invites/accept',
  asyncHandler(async (req, res) => {
    const body = parse(acceptSchema, req.body, 'An invitation token is required.');
    res.json({ ok: true, data: await service.acceptInvite(actorOf(req), body.token) });
  }),
);

router.patch(
  '/members/:memberId',
  asyncHandler(async (req, res) => {
    const body = parse(
      memberRoleSchema,
      req.body satisfies UpdateBusinessMemberRoleBody,
      'A role is required.',
    );
    res.json({
      ok: true,
      data: await service.updateMemberRole(
        actorOf(req),
        uuidParam(req.params.memberId, 'MEMBER_NOT_FOUND', 'Member not found in this workspace.'),
        body,
      ),
    });
  }),
);

router.delete(
  '/members/:memberId',
  asyncHandler(async (req, res) => {
    res.json({
      ok: true,
      data: await service.removeMember(
        actorOf(req),
        uuidParam(req.params.memberId, 'MEMBER_NOT_FOUND', 'Member not found in this workspace.'),
      ),
    });
  }),
);

router.post(
  '/transfer-ownership',
  asyncHandler(async (req, res) => {
    const body = parse(
      transferSchema,
      req.body satisfies TransferBusinessOwnershipBody,
      'Confirm the transfer with the workspace name.',
    );
    res.json({ ok: true, data: await service.transferOwnership(actorOf(req), body) });
  }),
);

export { router as businessTeamsRouter };
