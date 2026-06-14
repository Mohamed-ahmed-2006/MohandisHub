import { randomBytes, createHash } from 'node:crypto';

import type {
  BusinessTeamOverview,
  BusinessTeamPermission,
  CreateBusinessInviteBody,
  CreateBusinessRoleBody,
  DeleteBusinessRoleBody,
} from '@mohandishub/shared';
import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../../db/pool.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { sendTransactionalEmail } from '../../utils/send-transactional-email.js';

const router = Router();
router.use(authenticate, requireEmailVerified);

const permissionSchema = z.enum([
  'manage_team',
  'manage_services',
  'manage_jobs',
  'manage_reservations',
  'view_wallet',
  'manage_support_disputes',
  'view_analytics',
]);

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

type ReqUser = { id: string; role?: string; email?: string; displayName?: string };

const BUILT_IN_ROLES: Array<{ key: string; name: string; permissions: BusinessTeamPermission[] }> =
  [
    {
      key: 'owner',
      name: 'Owner',
      permissions: [
        'manage_team',
        'manage_services',
        'manage_jobs',
        'manage_reservations',
        'view_wallet',
        'manage_support_disputes',
        'view_analytics',
      ],
    },
    {
      key: 'manager',
      name: 'Manager',
      permissions: [
        'manage_services',
        'manage_jobs',
        'manage_reservations',
        'manage_support_disputes',
        'view_analytics',
      ],
    },
    {
      key: 'member',
      name: 'Member',
      permissions: ['manage_jobs', 'manage_reservations', 'view_analytics'],
    },
    { key: 'viewer', name: 'Viewer', permissions: ['view_analytics'] },
  ];

function requireUser(req: { user?: ReqUser }): ReqUser {
  if (!req.user?.id) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function ensureOwnerTeam(user: ReqUser) {
  if (user.role !== 'business') {
    throw new HttpError({
      statusCode: 403,
      code: 'BUSINESS_ROLE_REQUIRED',
      message: 'Business team management requires a business account.',
    });
  }
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    let team = (
      await client.query<{ id: string; business_id: string; name: string | null }>(
        `SELECT id, business_id, name FROM business_teams WHERE business_id = $1 LIMIT 1`,
        [user.id],
      )
    ).rows[0];
    if (!team) {
      team = (
        await client.query<{ id: string; business_id: string; name: string | null }>(
          `INSERT INTO business_teams (business_id, name)
           VALUES ($1, $2)
           RETURNING id, business_id, name`,
          [user.id, user.displayName ?? 'Business team'],
        )
      ).rows[0]!;
    }

    for (const role of BUILT_IN_ROLES) {
      await client.query(
        `INSERT INTO business_team_roles (team_id, name, role_key, built_in, permissions)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (team_id, role_key)
         DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now()`,
        [team.id, role.name, role.key, JSON.stringify(role.permissions)],
      );
    }
    const ownerRole = (
      await client.query<{ id: string }>(
        `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'owner' LIMIT 1`,
        [team.id],
      )
    ).rows[0]!;
    await client.query(
      `INSERT INTO business_members (team_id, user_id, role, role_id)
       VALUES ($1, $2, 'owner', $3)
       ON CONFLICT (team_id, user_id)
       DO UPDATE SET role = 'owner', role_id = EXCLUDED.role_id`,
      [team.id, user.id, ownerRole.id],
    );
    await client.query('COMMIT');
    return team;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function audit(
  teamId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId?: string,
  detail?: unknown,
) {
  await getPool().query(
    `INSERT INTO business_team_audit_log (team_id, actor_user_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [teamId, actorId, action, entityType, entityId ?? null, JSON.stringify(detail ?? {})],
  );
}

async function getOverview(user: ReqUser): Promise<BusinessTeamOverview> {
  const team = await ensureOwnerTeam(user);
  const db = getPool();
  const [rolesResult, membersResult, invitesResult] = await Promise.all([
    db.query<{
      id: string;
      name: string;
      role_key: string;
      built_in: boolean;
      permissions: BusinessTeamPermission[];
      member_count: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT r.id, r.name, r.role_key, r.built_in, r.permissions,
              count(m.id)::text AS member_count, r.created_at, r.updated_at
       FROM business_team_roles r
       LEFT JOIN business_members m ON m.role_id = r.id
       WHERE r.team_id = $1
       GROUP BY r.id
       ORDER BY r.built_in DESC, r.created_at ASC`,
      [team.id],
    ),
    db.query<{
      id: string;
      user_id: string;
      email: string | null;
      display_name: string | null;
      role_id: string;
      role_name: string;
      role_key: string;
      created_at: Date;
    }>(
      `SELECT m.id, m.user_id, u.email, u.display_name, r.id AS role_id,
              r.name AS role_name, r.role_key, m.created_at
       FROM business_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN business_team_roles r ON r.id = m.role_id
       WHERE m.team_id = $1
       ORDER BY m.created_at ASC`,
      [team.id],
    ),
    db.query<{
      id: string;
      email: string;
      role_id: string;
      role_name: string;
      status: 'pending' | 'accepted' | 'revoked' | 'expired';
      expires_at: Date;
      created_at: Date;
      accepted_at: Date | null;
    }>(
      `SELECT i.id, i.email, i.role_id, r.name AS role_name, i.status,
              i.expires_at, i.created_at, i.accepted_at
       FROM business_team_invites i
       JOIN business_team_roles r ON r.id = i.role_id
       WHERE i.team_id = $1
       ORDER BY i.created_at DESC`,
      [team.id],
    ),
  ]);
  return {
    team: { id: team.id, businessId: team.business_id, name: team.name },
    roles: rolesResult.rows.map((r) => ({
      id: r.id,
      name: r.name,
      key: r.role_key,
      builtIn: r.built_in,
      permissions: Array.isArray(r.permissions) ? r.permissions : [],
      memberCount: parseInt(r.member_count, 10) || 0,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    })),
    members: membersResult.rows.map((m) => ({
      id: m.id,
      userId: m.user_id,
      email: m.email,
      displayName: m.display_name,
      roleId: m.role_id,
      roleName: m.role_name,
      roleKey: m.role_key,
      createdAt: m.created_at.toISOString(),
    })),
    invites: invitesResult.rows.map((i) => ({
      id: i.id,
      email: i.email,
      roleId: i.role_id,
      roleName: i.role_name,
      status: i.status,
      expiresAt: i.expires_at.toISOString(),
      createdAt: i.created_at.toISOString(),
      acceptedAt: i.accepted_at?.toISOString() ?? null,
    })),
  };
}

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await getOverview(requireUser(req)) });
  }),
);

router.post(
  '/roles',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const parsed = roleSchema.safeParse(req.body satisfies CreateBusinessRoleBody);
    if (!parsed.success)
      throw new HttpError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid role.',
        details: parsed.error.flatten().fieldErrors,
      });
    const team = await ensureOwnerTeam(user);
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO business_team_roles (team_id, name, role_key, built_in, permissions)
     VALUES ($1, $2, $3, false, $4)
     RETURNING id`,
      [team.id, parsed.data.name, `custom_${Date.now()}`, JSON.stringify(parsed.data.permissions)],
    );
    await audit(team.id, user.id, 'business_team.role.create', 'role', rows[0]?.id, parsed.data);
    res.status(201).json({ ok: true, data: await getOverview(user) });
  }),
);

router.patch(
  '/roles/:roleId',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const parsed = roleSchema.safeParse(req.body satisfies CreateBusinessRoleBody);
    if (!parsed.success)
      throw new HttpError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid role.',
        details: parsed.error.flatten().fieldErrors,
      });
    const team = await ensureOwnerTeam(user);
    const { rowCount } = await getPool().query(
      `UPDATE business_team_roles
     SET name = $3, permissions = $4, updated_at = now()
     WHERE team_id = $1 AND id = $2 AND built_in = false`,
      [team.id, req.params.roleId, parsed.data.name, JSON.stringify(parsed.data.permissions)],
    );
    if (!rowCount)
      throw new HttpError({
        statusCode: 404,
        code: 'ROLE_NOT_FOUND',
        message: 'Custom role not found.',
      });
    await audit(
      team.id,
      user.id,
      'business_team.role.update',
      'role',
      req.params.roleId,
      parsed.data,
    );
    res.json({ ok: true, data: await getOverview(user) });
  }),
);

router.delete(
  '/roles/:roleId',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const parsed = deleteRoleSchema.safeParse(req.body satisfies DeleteBusinessRoleBody);
    if (!parsed.success)
      throw new HttpError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Replacement role is required.',
        details: parsed.error.flatten().fieldErrors,
      });
    const team = await ensureOwnerTeam(user);
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const role = (
        await client.query<{ built_in: boolean; role_key: string }>(
          `SELECT built_in, role_key FROM business_team_roles WHERE team_id = $1 AND id = $2 FOR UPDATE`,
          [team.id, req.params.roleId],
        )
      ).rows[0];
      if (!role || role.built_in || role.role_key === 'owner')
        throw new HttpError({
          statusCode: 400,
          code: 'ROLE_DELETE_BLOCKED',
          message: 'Only custom non-owner roles can be deleted.',
        });
      const replacement = (
        await client.query<{ id: string }>(
          `SELECT id FROM business_team_roles WHERE team_id = $1 AND id = $2`,
          [team.id, parsed.data.replacementRoleId],
        )
      ).rows[0];
      if (!replacement || replacement.id === req.params.roleId)
        throw new HttpError({
          statusCode: 400,
          code: 'INVALID_REPLACEMENT_ROLE',
          message: 'Choose a different replacement role.',
        });
      await client.query(
        `UPDATE business_members SET role_id = $3 WHERE team_id = $1 AND role_id = $2`,
        [team.id, req.params.roleId, replacement.id],
      );
      await client.query(`DELETE FROM business_team_roles WHERE team_id = $1 AND id = $2`, [
        team.id,
        req.params.roleId,
      ]);
      await client.query('COMMIT');
      await audit(
        team.id,
        user.id,
        'business_team.role.delete',
        'role',
        req.params.roleId,
        parsed.data,
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true, data: await getOverview(user) });
  }),
);

router.post(
  '/invites',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const parsed = inviteSchema.safeParse(req.body satisfies CreateBusinessInviteBody);
    if (!parsed.success)
      throw new HttpError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid invite.',
        details: parsed.error.flatten().fieldErrors,
      });
    const team = await ensureOwnerTeam(user);
    const token = randomBytes(24).toString('hex');
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO business_team_invites (team_id, email, role_id, token_hash, invited_by)
     SELECT $1, $2, r.id, $4, $5
     FROM business_team_roles r
     WHERE r.team_id = $1 AND r.id = $3
     RETURNING id`,
      [team.id, parsed.data.email.toLowerCase(), parsed.data.roleId, tokenHash(token), user.id],
    );
    if (!rows[0])
      throw new HttpError({ statusCode: 400, code: 'INVALID_ROLE', message: 'Role not found.' });
    await audit(team.id, user.id, 'business_team.invite.create', 'invite', rows[0].id, {
      email: parsed.data.email,
    });
    void sendTransactionalEmail({
      to: parsed.data.email,
      subject: 'You were invited to MohandisHub',
      preheader: 'Business team invitation',
      title: 'Business team invitation',
      introLines: [
        'You were invited to join a MohandisHub business team.',
        `Invitation token: ${token}`,
      ],
    });
    res.status(201).json({ ok: true, data: await getOverview(user) });
  }),
);

router.post(
  '/invites/:inviteId/revoke',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const team = await ensureOwnerTeam(user);
    const { rowCount } = await getPool().query(
      `UPDATE business_team_invites
     SET status = 'revoked', updated_at = now()
     WHERE team_id = $1 AND id = $2 AND status = 'pending'`,
      [team.id, req.params.inviteId],
    );
    if (!rowCount)
      throw new HttpError({
        statusCode: 404,
        code: 'INVITE_NOT_FOUND',
        message: 'Pending invite not found.',
      });
    await audit(team.id, user.id, 'business_team.invite.revoke', 'invite', req.params.inviteId);
    res.json({ ok: true, data: await getOverview(user) });
  }),
);

router.post(
  '/invites/accept',
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const token = z.object({ token: z.string().min(20).max(200) }).parse(req.body).token;
    const db = getPool();
    const client = await db.connect();
    let teamId = '';
    try {
      await client.query('BEGIN');
      const invite = (
        await client.query<{ id: string; team_id: string; role_id: string }>(
          `SELECT id, team_id, role_id FROM business_team_invites
       WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()
       FOR UPDATE`,
          [tokenHash(token)],
        )
      ).rows[0];
      if (!invite)
        throw new HttpError({
          statusCode: 404,
          code: 'INVITE_NOT_FOUND',
          message: 'Invite is invalid or expired.',
        });
      teamId = invite.team_id;
      await client.query(
        `INSERT INTO business_members (team_id, user_id, role, role_id)
       VALUES ($1, $2, 'member', $3)
       ON CONFLICT (team_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
        [invite.team_id, user.id, invite.role_id],
      );
      await client.query(
        `UPDATE business_team_invites SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = $1`,
        [invite.id],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await audit(teamId, user.id, 'business_team.invite.accept', 'invite');
    res.json({ ok: true, data: { accepted: true } });
  }),
);

export { router as businessTeamsRouter };
