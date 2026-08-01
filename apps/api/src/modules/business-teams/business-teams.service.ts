// ---------------------------------------------------------------------------
// Business workspace membership and invitations.
// ---------------------------------------------------------------------------
// Every operation here runs the same shape: resolve the caller's standing in
// their own workspace (never one they named), check the capability that the
// operation actually needs, do the work in one transaction with the rows it
// touches locked, then write an audit row. The HTTP layer above holds no
// authorization logic at all.
//
// The two properties that drove most of the design:
//
//   * an invitation is used ONCE. Ten simultaneous accepts, an accept racing a
//     revoke, an accept from an account the invitation was not addressed to —
//     each has one right answer, and each is settled by locking the invitation
//     row before anything is decided rather than by an application-level check
//     that another connection can slip past;
//
//   * a workspace has ONE owner, at every commit. The partial unique index
//     added in 20260731120000 bounds that from above and a deferred constraint
//     trigger bounds it from below, so neither this service nor direct SQL can
//     leave a workspace with none. Ownership transfer is not available — see
//     `transferOwnership` at the bottom of this file for why.
// ---------------------------------------------------------------------------

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type {
  BusinessInviteAcceptResult,
  BusinessInvitePreview,
  BusinessInvitePreviewState,
  BusinessTeamInvite,
  BusinessTeamInviteStatus,
  BusinessTeamOverview,
  BusinessTeamPermission,
  BusinessWorkspaceList,
} from '@mohandishub/shared';
import type { Pool, PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { sendTransactionalEmail } from '../../utils/send-transactional-email.js';

import {
  allowedActionsFor,
  canAdministerTeam,
  listAccessibleWorkspaces,
  readWorkspaceContext,
  requireRoleManagement,
  requireTeamAdministration,
  requireWorkspace,
  workspaceNotAccessible,
  type WorkspaceContext,
} from './business-teams.authorization.js';
import {
  ALL_BUSINESS_TEAM_PERMISSIONS,
  BUILT_IN_ROLE_SEEDS,
  DEFAULT_TEAM_SEAT_CEILING,
  INVITE_TTL_DAYS,
  LEGACY_BUILT_IN_ROLE_KEYS,
  isAssignableRole,
  isLaunchPermission,
  splitPermissions,
  tierForRole,
  tierForStoredRole,
} from './business-teams.constants.js';

export type Actor = { id: string; role?: string };

type Queryable = Pick<Pool | PoolClient, 'query'>;

const httpError = (statusCode: number, code: string, message: string): HttpError =>
  new HttpError({ statusCode, code, message });

// ---------------------------------------------------------------------------
// Token handling.
// ---------------------------------------------------------------------------
// The raw token is base64url and the stored digest is lowercase hex. That is not
// cosmetic: the CHECK on `token_hash` accepts only 64 hex characters, so a raw
// token physically cannot be written into the column that is supposed to hold
// its digest. The two alphabets disagree, and the database enforces which one it
// will accept.

/** 32 bytes of CSPRNG output, URL-safe so it survives an email link intact. */
const issueToken = (): string => randomBytes(32).toString('base64url');

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * The email comparison that decides whether an invitation is addressed to the
 * signed-in account.
 *
 * `auth.repository` looks accounts up with `email.toLowerCase()`, so lowercasing
 * is the canonical form this project already relies on. Trimming is added
 * because an invited address arrives from a form; it can only ever make two
 * values that the repository would already treat as one compare equal.
 */
export const canonicalEmail = (email: string): string => email.trim().toLowerCase();

/** Constant-time comparison, so a mismatch does not leak through timing. */
const emailsMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(canonicalEmail(a), 'utf8');
  const right = Buffer.from(canonicalEmail(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/**
 * `bob@example.com` -> `b••@example.com`.
 *
 * Enough for the invited person to recognise their own address, not enough for
 * a leaked link to hand a stranger a working one.
 */
export const maskEmail = (email: string): string => {
  const canonical = canonicalEmail(email);
  const at = canonical.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = canonical.slice(0, at);
  const domain = canonical.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
};

// ---------------------------------------------------------------------------
// Transaction helper.
// ---------------------------------------------------------------------------

const inTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const audit = async (
  db: Queryable,
  params: {
    teamId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId?: string | null | undefined;
    detail?: Record<string, unknown> | undefined;
  },
): Promise<void> => {
  await db.query(
    `INSERT INTO business_team_audit_log
       (team_id, actor_user_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.teamId,
      params.actorId,
      params.action,
      params.entityType,
      params.entityId ?? null,
      JSON.stringify(params.detail ?? {}),
    ],
  );
};

// ---------------------------------------------------------------------------
// Workspace provisioning.
// ---------------------------------------------------------------------------

/**
 * Make sure a business account has a workspace, its built-in roles and an owner.
 *
 * Called only for accounts whose primary role is `business` — the account that
 * OWNS a workspace, not the people invited into one.
 *
 * The version this replaces looked for a missing row with `SELECT ... FOR
 * UPDATE` and then inserted. A missing row locks no gap at READ COMMITTED, so
 * ten concurrent first requests could each find nothing and each commit a
 * separate workspace, splitting one business into several teams with separate
 * owners, roles, invitations and audit histories. `ON CONFLICT DO NOTHING`
 * against the unique index added in 20260731120000 is the fix: at most one
 * INSERT can win, every loser reads the winner's row, and all ten callers end up
 * on the same workspace. No advisory lock and no retry loop — the database
 * already knows how to arbitrate this.
 *
 * It is also careful in one way its predecessor was not: it never forces the
 * business account back to owner. The original helper re-asserted `role =
 * 'owner'` on every single request. The owner membership is created only when
 * the workspace has no owner at all.
 */
const provisionWorkspace = async (actor: Actor): Promise<string> =>
  inTransaction(async (client) => {
    const displayName = await client.query<{ display_name: string | null }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [actor.id],
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO business_teams (business_id, name)
       VALUES ($1, $2)
       ON CONFLICT (business_id) DO NOTHING
       RETURNING id`,
      [actor.id, displayName.rows[0]?.display_name ?? 'Business team'],
    );

    // DO NOTHING returns no row when another transaction won. Its row is
    // committed by the time this SELECT runs, because the conflicting INSERT
    // blocked here until that transaction ended.
    const teamId =
      inserted.rows[0]?.id ??
      (
        await client.query<{ id: string }>(`SELECT id FROM business_teams WHERE business_id = $1`, [
          actor.id,
        ])
      ).rows[0]?.id;

    if (!teamId) {
      // The only way to reach this is a conflicting transaction that rolled
      // back after this one saw its lock. Failing is correct; the next request
      // provisions cleanly.
      throw httpError(
        409,
        'WORKSPACE_PROVISIONING_CONFLICT',
        'Could not initialise the workspace. Please try again.',
      );
    }

    // Built-in roles are upserted so a workspace created before a permission was
    // added picks it up. `viewer` is NOT in the seed list: existing rows keep
    // working, new workspaces simply never get one.
    for (const seed of BUILT_IN_ROLE_SEEDS) {
      await client.query(
        `INSERT INTO business_team_roles (team_id, name, role_key, built_in, permissions)
         VALUES ($1, $2, $3, true, $4::jsonb)
         ON CONFLICT (team_id, role_key)
         DO UPDATE SET name = EXCLUDED.name,
                       permissions = EXCLUDED.permissions,
                       built_in = true,
                       updated_at = now()`,
        [teamId, seed.name, seed.key, JSON.stringify(seed.permissions)],
      );
    }

    const ownerRole = await client.query<{ id: string }>(
      `SELECT id FROM business_team_roles WHERE team_id = $1 AND role_key = 'owner' LIMIT 1`,
      [teamId],
    );

    // Only if the workspace has no owner. The deferred constraint trigger added
    // in 20260731120000 checks the result at commit, so a transaction that
    // created a team and failed to give it an owner cannot commit at all.
    const ownerInsert = await client.query<{ id: string }>(
      `INSERT INTO business_members (team_id, user_id, role, role_id)
       SELECT $1, $2, 'owner', $3
        WHERE NOT EXISTS (
          SELECT 1 FROM business_members WHERE team_id = $1 AND role = 'owner'
        )
          AND NOT EXISTS (
          SELECT 1 FROM business_members WHERE team_id = $1 AND user_id = $2
        )
       RETURNING id`,
      [teamId, actor.id, ownerRole.rows[0]?.id ?? null],
    );

    // Only the transaction that actually created something writes history, so a
    // repeat first-access request does not append an audit row per page load.
    if (inserted.rows[0]) {
      await audit(client, {
        teamId,
        actorId: actor.id,
        action: 'business_team.workspace.provision',
        entityType: 'workspace',
        entityId: teamId,
        detail: { ownerMemberId: ownerInsert.rows[0]?.id ?? null },
      });
    }

    return teamId;
  });

/**
 * The entry point every team operation starts from.
 *
 * `teamId` selects among the workspaces this caller already belongs to. It is
 * matched inside the resolver's own membership query, so it can only ever narrow
 * that set — supplying somebody else's workspace matches nothing and is refused
 * with the same answer as supplying an id that does not exist.
 *
 * A business account with no workspace yet gets one, but only when it is asking
 * for its own: provisioning is never a response to a `teamId` the caller cannot
 * reach.
 */
export const resolveContext = async (
  actor: Actor,
  teamId?: string  ,
): Promise<WorkspaceContext> => {
  const pool = getPool();
  let context = await readWorkspaceContext(pool, actor.id, teamId);

  if (!context && teamId !== undefined) {
    // Named a workspace, and it is not one of theirs. Refused BEFORE any
    // provisioning: a request naming somebody else's workspace must not have
    // the side effect of creating one, and a caller cannot be asking for their
    // own by id when they have none. Deliberately the same answer whether the
    // workspace exists or not.
    throw workspaceNotAccessible();
  }

  if ((!context || !context.memberId) && teamId === undefined && actor.role === 'business') {
    await provisionWorkspace(actor);
    context = await readWorkspaceContext(pool, actor.id, undefined);
  }

  return requireWorkspace(context);
};

/** Every workspace the caller can open, and which one `/me` defaults to. */
export const listWorkspaces = async (actor: Actor): Promise<BusinessWorkspaceList> => {
  const pool = getPool();
  // A business account that has never opened the team screen has no workspace
  // row yet. Listing is a read, but for its own account this is also the first
  // access, so it provisions exactly as `/me` would.
  if (actor.role === 'business') {
    const owned = await pool.query<{ id: string }>(
      `SELECT id FROM business_teams WHERE business_id = $1`,
      [actor.id],
    );
    if (!owned.rows[0]) await provisionWorkspace(actor);
  }

  const workspaces = await listAccessibleWorkspaces(pool, actor.id);
  return {
    workspaces,
    defaultTeamId: workspaces[0]?.teamId ?? null,
  };
};

// ---------------------------------------------------------------------------
// Overview.
// ---------------------------------------------------------------------------

/** Read a stored role permission array and split it into enforced/reserved. */
const rolePermissions = (
  value: unknown,
): { effective: BusinessTeamPermission[]; reserved: BusinessTeamPermission[] } => {
  const known = new Set<string>(ALL_BUSINESS_TEAM_PERMISSIONS);
  const stored = Array.isArray(value)
    ? (value as unknown[]).filter(
        (v): v is BusinessTeamPermission => typeof v === 'string' && known.has(v),
      )
    : [];
  return splitPermissions(stored);
};

const inviteStatusFor = (row: { status: string; expires_at: Date }): BusinessTeamInviteStatus => {
  if (row.status === 'pending' && row.expires_at.getTime() <= Date.now()) return 'expired';
  return row.status as BusinessTeamInviteStatus;
};

export const getOverview = async (
  actor: Actor,
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = await resolveContext(actor, teamId);
  const db = getPool();

  const [rolesResult, membersResult, invitesResult] = await Promise.all([
    db.query<{
      id: string;
      name: string;
      role_key: string;
      built_in: boolean;
      is_legacy: boolean;
      permissions: unknown;
      member_count: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT r.id, r.name, r.role_key, r.built_in, r.is_legacy, r.permissions,
              count(m.id)::text AS member_count, r.created_at, r.updated_at
         FROM business_team_roles r
         LEFT JOIN business_members m ON m.role_id = r.id
        WHERE r.team_id = $1
        GROUP BY r.id
        ORDER BY r.built_in DESC, r.created_at ASC`,
      [context.teamId],
    ),
    db.query<{
      id: string;
      user_id: string;
      email: string | null;
      display_name: string | null;
      member_role: string;
      role_id: string | null;
      role_name: string | null;
      role_key: string | null;
      created_at: Date;
    }>(
      `SELECT m.id, m.user_id, u.email, u.display_name, m.role AS member_role,
              r.id AS role_id, r.name AS role_name, r.role_key, m.created_at
         FROM business_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN business_team_roles r ON r.id = m.role_id
        WHERE m.team_id = $1
        ORDER BY (m.role = 'owner') DESC, m.created_at ASC`,
      [context.teamId],
    ),
    // Invitations are only ever listed for someone who may administer the team.
    // A plain member has no business seeing who else was approached.
    canAdministerTeam(context)
      ? db.query<{
          id: string;
          email: string;
          role_id: string;
          role_name: string;
          status: string;
          expires_at: Date;
          created_at: Date;
          accepted_at: Date | null;
        }>(
          // The snapshot first: it is what this invitation actually offered.
          // The joined role name is the fallback for rows written before the
          // column existed, and for nothing else.
          `SELECT i.id, i.email, i.role_id,
                  COALESCE(i.role_name_snapshot, r.name) AS role_name, i.status,
                  i.expires_at, i.created_at, i.accepted_at
             FROM business_team_invites i
             JOIN business_team_roles r ON r.id = i.role_id
            WHERE i.team_id = $1
            ORDER BY i.created_at DESC`,
          [context.teamId],
        )
      : Promise.resolve({ rows: [] as never[] }),
  ]);

  const invites: BusinessTeamInvite[] = invitesResult.rows.map((i) => ({
    id: i.id,
    email: i.email,
    roleId: i.role_id,
    roleName: i.role_name,
    status: inviteStatusFor(i),
    expiresAt: i.expires_at.toISOString(),
    createdAt: i.created_at.toISOString(),
    acceptedAt: i.accepted_at?.toISOString() ?? null,
  }));

  return {
    team: { id: context.teamId, businessId: context.businessAccountId, name: context.teamName },
    viewer: {
      userId: context.userId,
      memberId: context.memberId,
      tier: context.tier,
      isOwner: context.isOwner,
      roleId: context.roleId,
      roleName: context.roleName,
      roleKey: context.roleKey,
      permissions: context.permissions,
      reservedPermissions: context.reservedPermissions,
      allowedActions: allowedActionsFor(context),
    },
    roles: rolesResult.rows.map((r) => ({
      id: r.id,
      name: r.name,
      key: r.role_key,
      builtIn: r.built_in,
      legacy: r.is_legacy || (r.built_in && LEGACY_BUILT_IN_ROLE_KEYS.has(r.role_key)),
      tier: tierForRole({ roleKey: r.role_key, builtIn: r.built_in }),
      assignable: isAssignableRole({ roleKey: r.role_key, builtIn: r.built_in }) && !r.is_legacy,
      // Split, not filtered: a role that still carries `manage_services` from
      // before Wave 2G-A keeps it in the row and reports it as reserved. It is
      // never returned as something the role can do.
      permissions: rolePermissions(r.permissions).effective,
      reservedPermissions: rolePermissions(r.permissions).reserved,
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
      tier: tierForStoredRole(m.member_role),
      isOwner: m.member_role === 'owner',
      isSelf: m.user_id === context.userId,
      createdAt: m.created_at.toISOString(),
    })),
    invites,
  };
};

// ---------------------------------------------------------------------------
// Custom roles.
// ---------------------------------------------------------------------------

export const createRole = async (
  actor: Actor,
  body: { name: string; permissions: BusinessTeamPermission[] },
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = requireRoleManagement(await resolveContext(actor, teamId));
  // Belt and braces with the route schema: a role cannot be created carrying a
  // permission no endpoint reads, because storing one is how the previous
  // version came to advertise capabilities that did not exist.
  const permissions = body.permissions.filter(isLaunchPermission);

  await inTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      // A UUID rather than a timestamp. `custom_${Date.now()}` collided whenever
      // two roles were created inside the same millisecond, which surfaced as a
      // unique-violation 500 rather than as anything a user could act on.
      `INSERT INTO business_team_roles (team_id, name, role_key, built_in, permissions)
       VALUES ($1, $2, 'custom_' || gen_random_uuid()::text, false, $3::jsonb)
       RETURNING id`,
      [context.teamId, body.name, JSON.stringify(permissions)],
    );
    await audit(client, {
      teamId: context.teamId,
      actorId: actor.id,
      action: 'business_team.role.create',
      entityType: 'role',
      entityId: rows[0]?.id,
      detail: { name: body.name, permissions },
    });
  });

  return getOverview(actor, context.teamId);
};

export const updateRole = async (
  actor: Actor,
  roleId: string,
  body: { name: string; permissions: BusinessTeamPermission[] },
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = requireRoleManagement(await resolveContext(actor, teamId));

  await inTransaction(async (client) => {
    const existing = (
      await client.query<{ permissions: unknown }>(
        `SELECT permissions FROM business_team_roles
          WHERE team_id = $1 AND id = $2 AND built_in = false
          FOR UPDATE`,
        [context.teamId, roleId],
      )
    ).rows[0];
    if (!existing) {
      throw httpError(404, 'ROLE_NOT_FOUND', 'Custom role not found in this workspace.');
    }

    // Editing a role must not silently strip a reserved permission it was
    // configured with before Wave 2G-A split them. The caller decides the
    // enforced half; the reserved half is carried through untouched, so nothing
    // is lost and nothing starts working.
    const carried = rolePermissions(existing.permissions).reserved;
    const permissions = [...body.permissions.filter(isLaunchPermission), ...carried];

    await client.query(
      `UPDATE business_team_roles
          SET name = $3, permissions = $4::jsonb, updated_at = now()
        WHERE team_id = $1 AND id = $2 AND built_in = false`,
      [context.teamId, roleId, body.name, JSON.stringify(permissions)],
    );
    await audit(client, {
      teamId: context.teamId,
      actorId: actor.id,
      action: 'business_team.role.update',
      entityType: 'role',
      entityId: roleId,
      detail: { name: body.name, permissions },
    });
  });

  return getOverview(actor, context.teamId);
};

export const deleteRole = async (
  actor: Actor,
  roleId: string,
  body: { replacementRoleId: string },
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = requireRoleManagement(await resolveContext(actor, teamId));

  await inTransaction(async (client) => {
    const role = (
      await client.query<{ built_in: boolean; role_key: string }>(
        `SELECT built_in, role_key FROM business_team_roles
          WHERE team_id = $1 AND id = $2 FOR UPDATE`,
        [context.teamId, roleId],
      )
    ).rows[0];
    if (!role || role.built_in) {
      throw httpError(400, 'ROLE_DELETE_BLOCKED', 'Only custom roles can be deleted.');
    }

    const replacement = (
      await client.query<{ id: string; role_key: string; built_in: boolean; is_legacy: boolean }>(
        `SELECT id, role_key, built_in, is_legacy FROM business_team_roles
          WHERE team_id = $1 AND id = $2`,
        [context.teamId, body.replacementRoleId],
      )
    ).rows[0];
    if (
      !replacement ||
      replacement.id === roleId ||
      !isAssignableRole({ roleKey: replacement.role_key, builtIn: replacement.built_in }) ||
      replacement.is_legacy
    ) {
      throw httpError(
        400,
        'INVALID_REPLACEMENT_ROLE',
        'Choose a different assignable role from this workspace.',
      );
    }

    await client.query(
      `UPDATE business_members SET role_id = $3 WHERE team_id = $1 AND role_id = $2`,
      [context.teamId, roleId, replacement.id],
    );
    // An accepted invitation still points at the role it was issued for. Move
    // those too rather than let ON DELETE RESTRICT block the delete forever.
    // `role_name_snapshot` is deliberately NOT touched: the pointer moves so the
    // role can go, and the record of what was actually offered stays readable.
    await client.query(
      `UPDATE business_team_invites SET role_id = $3, updated_at = now()
        WHERE team_id = $1 AND role_id = $2`,
      [context.teamId, roleId, replacement.id],
    );
    await client.query(`DELETE FROM business_team_roles WHERE team_id = $1 AND id = $2`, [
      context.teamId,
      roleId,
    ]);
    await audit(client, {
      teamId: context.teamId,
      actorId: actor.id,
      action: 'business_team.role.delete',
      entityType: 'role',
      entityId: roleId,
      detail: { replacementRoleId: replacement.id },
    });
  });

  return getOverview(actor, context.teamId);
};

// ---------------------------------------------------------------------------
// Invitations.
// ---------------------------------------------------------------------------

/**
 * How many memberships this workspace may hold, and how many it already uses.
 *
 * The limit is the account's own `maxTeamSlots` plan entitlement, which has
 * existed in `plan_limits` since before this wave and is simply read here rather
 * than invented. No plan currently configures it, so the effective limit is the
 * technical ceiling — a guard against a workspace being used as an unbounded
 * invitation-email relay, not a commercial seat tier. Launch sells no seats.
 *
 * Counted inside the caller's transaction, under the workspace row lock, so two
 * simultaneous invitations cannot both see the last free seat.
 */
const readSeatUsage = async (
  db: Queryable,
  params: { teamId: string; businessAccountId: string },
): Promise<{ limit: number; used: number }> => {
  const { rows } = await db.query<{ slots: string | null; used: string }>(
    `SELECT p.plan_limits ->> 'maxTeamSlots' AS slots,
            (SELECT count(*)
               FROM business_members m
              WHERE m.team_id = $1)
            +
            (SELECT count(*)
               FROM business_team_invites i
              WHERE i.team_id = $1 AND i.status = 'pending' AND i.expires_at > now())
            AS used
       FROM users u
       LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.id = $2`,
    [params.teamId, params.businessAccountId],
  );

  const row = rows[0];
  const configured = row?.slots != null ? Number(row.slots) : NaN;
  return {
    limit: Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_TEAM_SEAT_CEILING,
    used: parseInt(row?.used ?? '0', 10) || 0,
  };
};

/**
 * Roles that may be handed out, looked up inside the caller's own workspace.
 *
 * Both the workspace and the assignability are checked in SQL, so naming a role
 * id from another workspace is a miss rather than a cross-workspace write.
 */
const loadAssignableRole = async (
  db: Queryable,
  teamId: string,
  roleId: string,
): Promise<{ id: string; name: string; role_key: string; built_in: boolean }> => {
  const { rows } = await db.query<{
    id: string;
    name: string;
    role_key: string;
    built_in: boolean;
    is_legacy: boolean;
  }>(
    `SELECT id, name, role_key, built_in, is_legacy
       FROM business_team_roles WHERE team_id = $1 AND id = $2`,
    [teamId, roleId],
  );
  const role = rows[0];
  if (!role) {
    throw httpError(400, 'ROLE_NOT_FOUND', 'That role does not exist in this workspace.');
  }
  if (role.role_key === 'owner') {
    throw httpError(
      400,
      'OWNER_ROLE_NOT_ASSIGNABLE',
      'Owner cannot be granted directly. Use ownership transfer.',
    );
  }
  if (role.is_legacy || !isAssignableRole({ roleKey: role.role_key, builtIn: role.built_in })) {
    throw httpError(400, 'ROLE_NOT_ASSIGNABLE', 'That role can no longer be assigned.');
  }
  return role;
};

export const createInvite = async (
  actor: Actor,
  body: { email: string; roleId: string },
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = requireTeamAdministration(await resolveContext(actor, teamId));
  const email = canonicalEmail(body.email);
  const token = issueToken();

  const delivery = await inTransaction(async (client) => {
    // Lock the workspace so two invitations to the same address cannot both
    // pass their duplicate checks before either inserts.
    await client.query(`SELECT id FROM business_teams WHERE id = $1 FOR UPDATE`, [context.teamId]);

    const role = await loadAssignableRole(client, context.teamId, body.roleId);

    // Already a member? An invitation would either do nothing or, worse, be
    // accepted and overwrite the role they already hold.
    const existingMember = await client.query<{ id: string }>(
      `SELECT m.id FROM business_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.team_id = $1 AND lower(btrim(u.email)) = $2`,
      [context.teamId, email],
    );
    if (existingMember.rowCount) {
      throw httpError(
        409,
        'ALREADY_A_MEMBER',
        'That person is already a member of this workspace.',
      );
    }

    // Retire pending invitations that have run out before testing for a live
    // one, so an abandoned invite cannot block the address forever.
    await client.query(
      `UPDATE business_team_invites
          SET status = 'expired', updated_at = now()
        WHERE team_id = $1 AND lower(btrim(email)) = $2
          AND status = 'pending' AND expires_at <= now()`,
      [context.teamId, email],
    );

    const live = await client.query<{ id: string }>(
      `SELECT id FROM business_team_invites
        WHERE team_id = $1 AND lower(btrim(email)) = $2 AND status = 'pending'`,
      [context.teamId, email],
    );
    if (live.rowCount) {
      throw httpError(
        409,
        'INVITE_ALREADY_PENDING',
        'An invitation to that address is already pending.',
      );
    }

    // A seat is a membership or a live invitation, counted together so a
    // workspace cannot queue its way past the limit.
    const seats = await readSeatUsage(client, {
      teamId: context.teamId,
      businessAccountId: context.businessAccountId,
    });
    if (seats.used >= seats.limit) {
      throw httpError(
        409,
        'TEAM_SEAT_LIMIT_REACHED',
        `This workspace already uses all ${seats.limit} of its team seats. Remove a member or revoke a pending invitation first.`,
      );
    }

    const inserted = await client.query<{ id: string; expires_at: Date }>(
      // `role_name_snapshot` is written once, here. Deleting the role later
      // moves `role_id` to a replacement so the delete is never blocked, and
      // this column is what keeps the historical answer readable.
      `INSERT INTO business_team_invites
         (team_id, email, role_id, role_name_snapshot, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval)
       RETURNING id, expires_at`,
      [
        context.teamId,
        email,
        role.id,
        role.name,
        hashInviteToken(token),
        actor.id,
        String(INVITE_TTL_DAYS),
      ],
    );

    await audit(client, {
      teamId: context.teamId,
      actorId: actor.id,
      action: 'business_team.invite.create',
      entityType: 'invite',
      entityId: inserted.rows[0]!.id,
      // The address is the point of the record. The token is not in it.
      detail: { email, roleId: role.id, roleName: role.name },
    });

    return {
      inviteId: inserted.rows[0]!.id,
      expiresAt: inserted.rows[0]!.expires_at,
      roleName: role.name,
    };
  });

  // After commit, never inside it: an email provider timing out must not roll
  // back an invitation that the workspace can already see, and an invitation
  // that failed to commit must never produce a live link.
  await deliverInviteEmail({
    email,
    token,
    teamName: context.teamName,
    roleName: delivery.roleName,
    expiresAt: delivery.expiresAt,
  });

  return getOverview(actor, context.teamId);
};

const deliverInviteEmail = async (params: {
  email: string;
  token: string;
  teamName: string | null;
  roleName: string;
  expiresAt: Date;
}): Promise<void> => {
  const webBase = (env.WEB_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const acceptUrl = `${webBase}/en/invitations/accept?token=${encodeURIComponent(params.token)}`;
  try {
    await sendTransactionalEmail({
      to: params.email,
      subject: 'You have been invited to a MohandisHub business team',
      preheader: 'Business team invitation',
      title: params.teamName
        ? `Join ${params.teamName} on MohandisHub`
        : 'Join a business team on MohandisHub',
      introLines: [
        params.teamName
          ? `You have been invited to join ${params.teamName} as ${params.roleName}.`
          : `You have been invited to join a business team as ${params.roleName}.`,
        'Open the link below with this email address to accept.',
      ],
      action: { kind: 'button', label: 'Accept invitation', url: acceptUrl },
      expiryText: `This invitation expires on ${params.expiresAt.toISOString().slice(0, 10)}.`,
      safetyText: 'If you were not expecting this invitation you can ignore this email.',
    });
  } catch (error) {
    // The invitation is committed and visible to the workspace, which can revoke
    // and re-send. Logged WITHOUT the token or the link.
    logger.warn('Business team invitation email failed to send', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
};

export const revokeInvite = async (
  actor: Actor,
  inviteId: string,
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = requireTeamAdministration(await resolveContext(actor, teamId));

  await inTransaction(async (client) => {
    const invite = (
      await client.query<{ id: string; status: string }>(
        // Scoped to the caller's own workspace, so an invitation id belonging to
        // another workspace simply is not found.
        `SELECT id, status FROM business_team_invites
          WHERE team_id = $1 AND id = $2 FOR UPDATE`,
        [context.teamId, inviteId],
      )
    ).rows[0];

    if (!invite) {
      throw httpError(404, 'INVITE_NOT_FOUND', 'Invitation not found in this workspace.');
    }
    // Accepted stays accepted: revoking cannot retroactively undo a membership.
    if (invite.status === 'accepted') {
      throw httpError(
        409,
        'INVITE_ALREADY_ACCEPTED',
        'That invitation was already accepted. Remove the member instead.',
      );
    }
    // Revoking twice is a no-op, not an error — the caller's intent is already
    // the state of the world.
    if (invite.status === 'revoked') return;

    await client.query(
      `UPDATE business_team_invites
          SET status = 'revoked', revoked_at = now(), revoked_by = $3, updated_at = now()
        WHERE id = $1 AND team_id = $2`,
      [inviteId, context.teamId, actor.id],
    );
    await audit(client, {
      teamId: context.teamId,
      actorId: actor.id,
      action: 'business_team.invite.revoke',
      entityType: 'invite',
      entityId: inviteId,
    });
  });

  return getOverview(actor, context.teamId);
};

const emptyPreview = (state: BusinessInvitePreviewState): BusinessInvitePreview => ({
  state,
  teamName: null,
  inviterDisplayName: null,
  maskedEmail: null,
  roleName: null,
  expiresAt: null,
  requiresAuthentication: true,
  signedInAccountMatches: null,
});

/**
 * What the acceptance page is allowed to know before anyone commits to anything.
 *
 * Every state is decided from the invitation row, server-side. A token that
 * matches nothing is `malformed` — the same answer as a token that never
 * existed, so the endpoint cannot be used to test guesses. Nothing here reveals
 * whether any email address has an account.
 */
export const previewInvite = async (params: {
  token: string;
  viewerId?: string | undefined;
}): Promise<BusinessInvitePreview> => {
  const db = getPool();
  const { rows } = await db.query<{
    id: string;
    email: string;
    status: string;
    expires_at: Date;
    team_name: string | null;
    role_name: string;
    inviter_name: string | null;
  }>(
    `SELECT i.id, i.email, i.status, i.expires_at,
            t.name AS team_name,
            COALESCE(i.role_name_snapshot, r.name) AS role_name,
            u.display_name AS inviter_name
       FROM business_team_invites i
       JOIN business_teams t ON t.id = i.team_id
       JOIN business_team_roles r ON r.id = i.role_id
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.token_hash = $1
      LIMIT 1`,
    [hashInviteToken(params.token)],
  );

  const invite = rows[0];
  if (!invite) return emptyPreview('malformed');

  let viewerEmail: string | null = null;
  if (params.viewerId) {
    const viewer = await db.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [params.viewerId],
    );
    viewerEmail = viewer.rows[0]?.email ?? null;
  }

  const matches = viewerEmail === null ? null : emailsMatch(viewerEmail, invite.email);

  const base: BusinessInvitePreview = {
    state: 'valid',
    teamName: invite.team_name,
    inviterDisplayName: invite.inviter_name,
    maskedEmail: maskEmail(invite.email),
    roleName: invite.role_name,
    expiresAt: invite.expires_at.toISOString(),
    requiresAuthentication: params.viewerId === undefined,
    signedInAccountMatches: matches,
  };

  if (invite.status === 'accepted') return { ...base, state: 'already_used' };
  if (invite.status === 'revoked') return { ...base, state: 'revoked' };
  if (invite.status === 'expired' || invite.expires_at.getTime() <= Date.now()) {
    return { ...base, state: 'expired' };
  }
  // Only a live invitation can be reported as addressed to the wrong account;
  // for a dead one the reason it cannot be used is the status, not the account.
  if (matches === false) return { ...base, state: 'wrong_account' };
  return base;
};

export const acceptInvite = async (
  actor: Actor,
  token: string,
): Promise<BusinessInviteAcceptResult> =>
  inTransaction(async (client) => {
    const account = (
      await client.query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [actor.id],
      )
    ).rows[0];
    if (!account) {
      throw httpError(401, 'UNAUTHORIZED', 'Authentication required.');
    }

    // The lock is the whole mechanism. Ten concurrent accepts queue here; the
    // first commits an acceptance and the other nine re-read a row that is no
    // longer pending. A revoke racing an accept takes the same lock, so exactly
    // one of the two wins and the loser sees the winner's committed state.
    const invite = (
      await client.query<{
        id: string;
        team_id: string;
        role_id: string;
        email: string;
        status: string;
        expires_at: Date;
      }>(
        `SELECT id, team_id, role_id, email, status, expires_at
           FROM business_team_invites
          WHERE token_hash = $1
          FOR UPDATE`,
        [hashInviteToken(token)],
      )
    ).rows[0];

    if (!invite) {
      throw httpError(404, 'INVITE_NOT_FOUND', 'This invitation link is not valid.');
    }

    // Identity before status, so a stranger holding a leaked link learns only
    // that it is not theirs — never whether it is still live.
    if (!emailsMatch(account.email, invite.email)) {
      throw httpError(
        403,
        'INVITE_WRONG_ACCOUNT',
        'This invitation was sent to a different email address. Sign in with that address to accept it.',
      );
    }

    if (invite.status === 'accepted') {
      // Idempotent for the invited person: the second click reports the state
      // that already exists rather than an error, and creates nothing.
      const existing = (
        await client.query<{
          role_name: string | null;
          member_role: string;
          team_name: string | null;
        }>(
          `SELECT r.name AS role_name, m.role AS member_role, t.name AS team_name
             FROM business_members m
             JOIN business_teams t ON t.id = m.team_id
             LEFT JOIN business_team_roles r ON r.id = m.role_id
            WHERE m.team_id = $1 AND m.user_id = $2`,
          [invite.team_id, actor.id],
        )
      ).rows[0];
      return {
        accepted: true,
        created: false,
        teamId: invite.team_id,
        teamName: existing?.team_name ?? null,
        roleName: existing?.role_name ?? null,
        tier: tierForStoredRole(existing?.member_role ?? 'member'),
      };
    }
    if (invite.status === 'revoked') {
      throw httpError(410, 'INVITE_REVOKED', 'This invitation was revoked.');
    }
    if (invite.status === 'expired' || invite.expires_at.getTime() <= Date.now()) {
      throw httpError(410, 'INVITE_EXPIRED', 'This invitation has expired.');
    }

    // Already a member through some other path: accept the invitation without
    // touching the membership. Overwriting it is how an existing Admin could be
    // silently demoted by an old invitation link.
    const already = (
      await client.query<{ id: string; role_id: string | null; role: string }>(
        `SELECT id, role_id, role FROM business_members
          WHERE team_id = $1 AND user_id = $2 FOR UPDATE`,
        [invite.team_id, actor.id],
      )
    ).rows[0];

    let memberId: string;
    let created: boolean;
    if (already) {
      memberId = already.id;
      created = false;
    } else {
      const inserted = await client.query<{ id: string }>(
        // The invitation's own role_id, preserved exactly. The tier column is
        // derived by the trigger, so there is no second place for it to drift.
        `INSERT INTO business_members (team_id, user_id, role_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [invite.team_id, actor.id, invite.role_id],
      );
      memberId = inserted.rows[0]!.id;
      created = true;
    }

    await client.query(
      `UPDATE business_team_invites
          SET status = 'accepted', accepted_at = now(), accepted_by = $2,
              accepted_member_id = $3, updated_at = now()
        WHERE id = $1`,
      [invite.id, actor.id, memberId],
    );

    await audit(client, {
      teamId: invite.team_id,
      actorId: actor.id,
      action: 'business_team.invite.accept',
      entityType: 'invite',
      entityId: invite.id,
      detail: { memberId, roleId: invite.role_id, createdMembership: created },
    });

    const summary = (
      await client.query<{
        team_name: string | null;
        role_name: string | null;
        member_role: string;
      }>(
        `SELECT t.name AS team_name, r.name AS role_name, m.role AS member_role
           FROM business_members m
           JOIN business_teams t ON t.id = m.team_id
           LEFT JOIN business_team_roles r ON r.id = m.role_id
          WHERE m.id = $1`,
        [memberId],
      )
    ).rows[0];

    return {
      accepted: true,
      created,
      teamId: invite.team_id,
      teamName: summary?.team_name ?? null,
      roleName: summary?.role_name ?? null,
      tier: tierForStoredRole(summary?.member_role ?? 'member'),
    };
  });

// ---------------------------------------------------------------------------
// Membership.
// ---------------------------------------------------------------------------

export const updateMemberRole = async (
  actor: Actor,
  memberId: string,
  body: { roleId: string },
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = requireTeamAdministration(await resolveContext(actor, teamId));

  await inTransaction(async (client) => {
    const member = (
      await client.query<{ id: string; user_id: string; role: string }>(
        `SELECT id, user_id, role FROM business_members
          WHERE team_id = $1 AND id = $2 FOR UPDATE`,
        [context.teamId, memberId],
      )
    ).rows[0];
    if (!member) {
      throw httpError(404, 'MEMBER_NOT_FOUND', 'Member not found in this workspace.');
    }
    // The owner does not change tier through this endpoint in either direction.
    // In either direction, and with no alternative route: ownership transfer is
    // unavailable, so the owner membership does not move at all.
    if (member.role === 'owner') {
      throw httpError(409, 'OWNER_ROLE_IMMUTABLE', 'The workspace owner role cannot be changed.');
    }

    // `loadAssignableRole` rejects the owner role and anything outside this
    // workspace, so neither an admin nor a delegate can grant ownership.
    const role = await loadAssignableRole(client, context.teamId, body.roleId);

    await client.query(`UPDATE business_members SET role_id = $3 WHERE team_id = $1 AND id = $2`, [
      context.teamId,
      memberId,
      role.id,
    ]);
    await audit(client, {
      teamId: context.teamId,
      actorId: actor.id,
      action: 'business_team.member.role_update',
      entityType: 'member',
      entityId: memberId,
      detail: { roleId: role.id, roleName: role.name, previousTier: member.role },
    });
  });

  return getOverview(actor, context.teamId);
};

export const removeMember = async (
  actor: Actor,
  memberId: string,
  teamId?: string  ,
): Promise<BusinessTeamOverview> => {
  const context = requireTeamAdministration(await resolveContext(actor, teamId));

  await inTransaction(async (client) => {
    const member = (
      await client.query<{ id: string; user_id: string; role: string }>(
        `SELECT id, user_id, role FROM business_members
          WHERE team_id = $1 AND id = $2 FOR UPDATE`,
        [context.teamId, memberId],
      )
    ).rows[0];
    // Stable, not silent: a member that is not in this workspace — including one
    // that belongs to somebody else's — is a 404 rather than a no-op success.
    if (!member) {
      throw httpError(404, 'MEMBER_NOT_FOUND', 'Member not found in this workspace.');
    }
    // Refused here, and refused again by the deferred constraint trigger if any
    // future path forgets: a committed workspace has exactly one owner.
    if (member.role === 'owner') {
      throw httpError(409, 'OWNER_CANNOT_BE_REMOVED', 'The workspace owner cannot be removed.');
    }
    // An admin removing themselves is fine; an admin removing the owner is not,
    // and is already refused above.
    await client.query(`DELETE FROM business_members WHERE team_id = $1 AND id = $2`, [
      context.teamId,
      memberId,
    ]);
    await audit(client, {
      teamId: context.teamId,
      actorId: actor.id,
      action: 'business_team.member.remove',
      entityType: 'member',
      entityId: memberId,
      detail: { removedUserId: member.user_id, tier: member.role },
    });
  });

  // The caller may have removed themselves, in which case they no longer have a
  // workspace to read. Report the removal rather than a 403 from the re-read.
  if (context.memberId === memberId) {
    return {
      team: { id: context.teamId, businessId: context.businessAccountId, name: context.teamName },
      viewer: {
        userId: context.userId,
        memberId: null,
        tier: 'member',
        isOwner: false,
        roleId: null,
        roleName: null,
        roleKey: null,
        permissions: [],
        reservedPermissions: [],
        allowedActions: {
          inviteMembers: false,
          revokeInvites: false,
          viewInvites: false,
          updateMemberRoles: false,
          removeMembers: false,
          manageRoles: false,
          transferOwnership: false,
        },
      },
      roles: [],
      members: [],
      invites: [],
    };
  }

  return getOverview(actor, context.teamId);
};

/**
 * Ownership transfer, refused.
 *
 * The operation that used to live here moved the Owner MEMBERSHIP: the target
 * became Owner, the previous owner became Admin, and the swap was atomic and
 * race-safe. What it could not move was ownership. `business_teams.business_id`
 * is immutable by trigger, and every service, job, advertisement, booking,
 * subscription, wallet balance and ledger row in the workspace is keyed to that
 * account — as is the primary-role check that most of those endpoints still
 * make. A "transferred" workspace would have had two principals: one holding
 * team administration and believing they owned the business, and one still
 * holding every asset and every charge.
 *
 * Splitting authority and calling it ownership is worse than not offering it, so
 * the endpoint answers with a stable code and changes nothing. No membership is
 * read, no lock is taken, no audit row is written — there is no mutation to
 * record. `allowedActionsFor` reports `transferOwnership: false` for everyone
 * including the owner, so no screen offers the action in the first place; this
 * is what a client that calls it anyway receives.
 *
 * The prerequisite is the workspace-principal architecture deferred to Wave
 * 2G-B: a business principal that is separable from the account that registered
 * it, so that assets, charges and financial history can be addressed by
 * workspace rather than by user id. Until that exists there is nothing to
 * transfer.
 */
export const transferOwnership = async (
  _actor: Actor,
  _body: { memberId: string; confirmation: string },
  _teamId?: string  ,
): Promise<never> => {
  await Promise.resolve();
  throw httpError(
    409,
    'OWNERSHIP_TRANSFER_NOT_AVAILABLE',
    'Workspace ownership transfer is not available. The business account that created this workspace owns its services, jobs, advertisements and financial history, and those cannot yet be moved.',
  );
};
