// ---------------------------------------------------------------------------
// Business workspace authorization — one resolver, used by every operation.
// ---------------------------------------------------------------------------
// Before this file, "may this person administer this business team?" was answered
// by a single line in one helper: `user.role !== 'business'`. That is the primary
// ACCOUNT role, which says what kind of account someone signed up with. It says
// nothing about whether they belong to a workspace, what standing they hold in
// it, or which permissions their role carries — and it locked every invited
// member out of the team screen entirely while letting any business account
// through unconditionally.
//
// Everything is resolved here instead, once, from the authenticated user id:
//
//   * the workspace. A caller may NAME one — a person can belong to several —
//     but naming is all it is: the identifier is matched inside this resolver's
//     own membership query, so it selects among what the caller already has and
//     can never widen it;
//   * ownership — the single `business_members` row whose tier is owner;
//   * active membership. A removed member has no row, so the resolver fails and
//     access ends at the next request rather than at the next token refresh;
//   * the built-in tier, from the stored membership role;
//   * the assigned role, built-in or custom;
//   * the permission array, read from the database rather than from the client.
//
// The result is a capability set that every route consults. Frontend visibility
// is decided from the same numbers, but it is decided AGAIN here on the way in,
// so a hidden button that is called directly is refused exactly like a visible
// one would be.
// ---------------------------------------------------------------------------

import type {
  BusinessTeamAllowedActions,
  BusinessTeamPermission,
  BusinessWorkspaceTier,
} from '@mohandishub/shared';
import type { Pool, PoolClient } from 'pg';

import { HttpError } from '../../utils/http-error.js';

import {
  ALL_BUSINESS_TEAM_PERMISSIONS,
  BUILT_IN_ROLE_SEEDS,
  LAUNCH_BUSINESS_TEAM_PERMISSIONS,
  splitPermissions,
  tierForStoredRole,
} from './business-teams.constants.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type WorkspaceContext = {
  teamId: string;
  /**
   * The account that owns this workspace's services, jobs, advertisements,
   * wallet and financial history. Immutable — see the trigger added in
   * 20260731120000, and unmovable: ownership transfer is not available.
   */
  businessAccountId: string;
  teamName: string | null;
  userId: string;
  /** Null when the caller owns the workspace account but has no membership row. */
  memberId: string | null;
  tier: BusinessWorkspaceTier;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
  roleKey: string | null;
  roleBuiltIn: boolean;
  /** Permissions an authorization decision reads. Wave 2G-A enforces one. */
  permissions: BusinessTeamPermission[];
  /** Stored on the role, enforced by nothing yet. Never a capability. */
  reservedPermissions: BusinessTeamPermission[];
};

const forbidden = (code: string, message: string): HttpError =>
  new HttpError({ statusCode: 403, code, message });

/**
 * Every workspace the caller can actually open, newest membership last.
 *
 * The account's primary role is not a term in this query. A customer, expert or
 * craftsman who accepted an invitation appears here exactly as a business
 * account does, which is the whole point: membership is the credential, and the
 * account role is a separate fact about the account.
 */
export const listAccessibleWorkspaces = async (
  db: Queryable,
  userId: string,
): Promise<
  Array<{
    teamId: string;
    teamName: string | null;
    tier: BusinessWorkspaceTier;
    isOwner: boolean;
    roleName: string | null;
    ownedByViewerAccount: boolean;
    memberCount: number;
    joinedAt: string;
  }>
> => {
  const { rows } = await db.query<{
    team_id: string;
    team_name: string | null;
    member_role: string;
    role_name: string | null;
    owned: boolean;
    member_count: string;
    joined_at: Date;
  }>(
    `SELECT t.id          AS team_id,
            t.name        AS team_name,
            m.role        AS member_role,
            r.name        AS role_name,
            (t.business_id = $1) AS owned,
            (SELECT count(*) FROM business_members mc WHERE mc.team_id = t.id)::text
                          AS member_count,
            m.created_at  AS joined_at
       FROM business_members m
       JOIN business_teams t ON t.id = m.team_id
       LEFT JOIN business_team_roles r ON r.id = m.role_id
      WHERE m.user_id = $1
      ORDER BY (t.business_id = $1) DESC, m.created_at ASC`,
    [userId],
  );

  return rows.map((row) => ({
    teamId: row.team_id,
    teamName: row.team_name,
    tier: tierForStoredRole(row.member_role),
    isOwner: row.member_role === 'owner',
    roleName: row.role_name,
    ownedByViewerAccount: row.owned,
    memberCount: parseInt(row.member_count, 10) || 0,
    joinedAt: row.joined_at.toISOString(),
  }));
};

/**
 * Read the caller's standing in one workspace.
 *
 * `teamId` is the workspace the caller ASKED for, and asking is all it is. The
 * query matches it against the caller's own membership rows, so a workspace the
 * caller does not belong to produces no row and the caller is refused — the
 * identifier selects among what they already have, and can never widen it.
 * Without one, the caller's own business workspace wins and otherwise their
 * oldest membership, which keeps every existing single-workspace client working
 * unchanged.
 *
 * Returns null rather than throwing when nothing matches, so the provisioning
 * path can tell "this business account has not been set up yet" apart from
 * "this person is not a member of that".
 */
export const readWorkspaceContext = async (
  db: Queryable,
  userId: string,
  teamId?: string,
): Promise<WorkspaceContext | null> => {
  const { rows } = await db.query<{
    team_id: string;
    business_id: string;
    team_name: string | null;
    member_id: string | null;
    member_role: string | null;
    role_id: string | null;
    role_name: string | null;
    role_key: string | null;
    role_built_in: boolean | null;
    permissions: unknown;
  }>(
    // Two ways in: the account that owns the workspace, and an active
    // membership. The `$2 IS NULL OR t.id = $2` arm is the selection — it can
    // only ever NARROW the set this caller already qualifies for, so a
    // workspace identifier from a client is a filter over their own rows and
    // never a way to reach somebody else's.
    `SELECT t.id            AS team_id,
            t.business_id   AS business_id,
            t.name          AS team_name,
            m.id            AS member_id,
            m.role          AS member_role,
            r.id            AS role_id,
            r.name          AS role_name,
            r.role_key      AS role_key,
            r.built_in      AS role_built_in,
            COALESCE(r.permissions, '[]'::jsonb) AS permissions
       FROM business_teams t
       LEFT JOIN business_members m
              ON m.team_id = t.id AND m.user_id = $1
       LEFT JOIN business_team_roles r
              ON r.id = m.role_id
      WHERE ($2::uuid IS NULL OR t.id = $2::uuid)
        AND (t.business_id = $1
             OR t.id IN (SELECT team_id FROM business_members WHERE user_id = $1))
      ORDER BY (t.business_id = $1) DESC, t.created_at ASC
      LIMIT 1`,
    [userId, teamId ?? null],
  );

  const row = rows[0];
  if (!row) return null;

  const tier = tierForStoredRole(row.member_role);
  const isOwner = tier === 'owner' && row.member_id !== null;
  const stored = splitPermissions(normalisePermissions(row.permissions));

  return {
    teamId: row.team_id,
    businessAccountId: row.business_id,
    teamName: row.team_name,
    userId,
    memberId: row.member_id,
    tier,
    isOwner,
    roleId: row.role_id,
    roleName: row.role_name,
    roleKey: row.role_key,
    roleBuiltIn: row.role_built_in === true,
    // The owner's capability is not an editable array. Ownership carries every
    // ENFORCED permission by definition, so a permission row that has drifted —
    // or a role whose array somebody trimmed — cannot lock an owner out of their
    // own workspace. It does not conjure the unenforced ones into working.
    permissions: isOwner ? [...LAUNCH_BUSINESS_TEAM_PERMISSIONS] : stored.effective,
    reservedPermissions: stored.reserved,
  };
};

const normalisePermissions = (value: unknown): BusinessTeamPermission[] => {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ALL_BUSINESS_TEAM_PERMISSIONS);
  return value.filter((v): v is BusinessTeamPermission => typeof v === 'string' && allowed.has(v));
};

export const hasPermission = (
  context: WorkspaceContext,
  permission: BusinessTeamPermission,
): boolean => context.isOwner || context.permissions.includes(permission);

/**
 * Whether the caller may run day-to-day team administration.
 *
 * Owner and Admin qualify by tier. A Member qualifies only by holding an
 * explicit `manage_team` permission on their assigned role — the narrow,
 * server-granted exception the product model allows. It never extends to
 * ownership.
 */
export const canAdministerTeam = (context: WorkspaceContext): boolean =>
  context.tier === 'owner' || context.tier === 'admin' || hasPermission(context, 'manage_team');

/**
 * Role management (creating, editing and deleting custom roles) is an
 * owner-level act: it decides what every other tier is able to do, so handing
 * it to a delegate would let a delegate widen themselves.
 */
export const canManageRoles = (context: WorkspaceContext): boolean => context.isOwner;

export const allowedActionsFor = (context: WorkspaceContext): BusinessTeamAllowedActions => {
  const administers = canAdministerTeam(context);
  return {
    inviteMembers: administers,
    revokeInvites: administers,
    viewInvites: administers,
    updateMemberRoles: administers,
    removeMembers: administers,
    manageRoles: canManageRoles(context),
    // Not "you are not allowed to", but "this does not exist yet". Moving the
    // Owner membership would move team administration while every service, job,
    // advertisement, booking, subscription and ledger row stayed with the
    // original account — split authority described to the user as ownership.
    // Reported false for everyone, including the owner, so no screen offers it.
    transferOwnership: false,
  };
};

// ---------------------------------------------------------------------------
// Guards. Each throws the stable error code the frontend and the tests rely on.
// ---------------------------------------------------------------------------

export const requireWorkspace = (context: WorkspaceContext | null): WorkspaceContext => {
  if (!context) {
    throw forbidden(
      'NO_BUSINESS_WORKSPACE',
      'You do not belong to a business workspace. Ask an owner or admin to invite you.',
    );
  }
  // A workspace that the caller can see but holds no membership in is not a
  // workspace they can act in. The only account that reaches this branch is one
  // whose team row exists while its owner membership does not, which the
  // provisioning path repairs before any operation runs.
  if (!context.memberId) {
    throw forbidden(
      'WORKSPACE_MEMBERSHIP_REQUIRED',
      'An active workspace membership is required for this action.',
    );
  }
  return context;
};

export const requireTeamAdministration = (context: WorkspaceContext): WorkspaceContext => {
  if (!canAdministerTeam(context)) {
    throw forbidden(
      'WORKSPACE_ADMIN_REQUIRED',
      'Team administration requires owner or admin permissions in this workspace.',
    );
  }
  return context;
};

export const requireRoleManagement = (context: WorkspaceContext): WorkspaceContext => {
  if (!canManageRoles(context)) {
    throw forbidden('WORKSPACE_OWNER_REQUIRED', 'Only the workspace owner can manage roles.');
  }
  return context;
};

export const requireOwnership = (context: WorkspaceContext): WorkspaceContext => {
  if (!context.isOwner) {
    throw forbidden(
      'WORKSPACE_OWNER_REQUIRED',
      'Only the current workspace owner can perform this action.',
    );
  }
  return context;
};

/**
 * Whether the caller may hold a workspace's `teamId` at all.
 *
 * Used by the selection path to turn "no row matched" into the right answer:
 * a workspace that exists but is not theirs, and a workspace that does not
 * exist, are the same 403 — nothing here confirms that a team id is real.
 */
export const workspaceNotAccessible = (): HttpError =>
  forbidden('WORKSPACE_NOT_ACCESSIBLE', 'You do not have access to that workspace.');

/**
 * Seed order for a brand-new workspace. Exported so the provisioning path and
 * the tests describe the same three roles.
 */
export const builtInRoleSeeds = () => BUILT_IN_ROLE_SEEDS;
