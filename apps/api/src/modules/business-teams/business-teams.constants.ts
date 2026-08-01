// ---------------------------------------------------------------------------
// Business workspace role model — the single definition of the built-in tiers.
// ---------------------------------------------------------------------------
// Three product tiers, and one historical value that maps onto one of them.
//
// The database has stored `owner | manager | member | viewer` in
// `business_members.role` since 20260318000002. The product exposes Owner,
// Admin and Member. Rather than rewrite every existing membership to a new
// vocabulary, `manager` IS the Admin tier: the stored value is preserved, the
// mapping happens here, and `manager` is never shown to a user as a tier of its
// own. `viewer` is neither — it is a seed that was never given a member, kept as
// a legacy role so any row that ever pointed at it stays valid, and no longer
// offered when a role has to be chosen.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wave 2G-A: what a workspace permission actually does today.
// ---------------------------------------------------------------------------
// Seven permission values have been storable since 20260613120000. Exactly one
// of them -- `manage_team` -- is read by an authorization decision. The other
// six name business-domain work (services, jobs, reservations, wallet, support,
// analytics) that is still authorized by the acting account's own primary role
// and its own `req.user.id`. Storing them changed nothing; returning them as
// "effective permissions" told the frontend, and through it the user, that a
// delegate could do work the API would refuse.
//
// So they are separated rather than deleted. `LAUNCH_BUSINESS_TEAM_PERMISSIONS`
// is what a role may be granted and what `GET /me` reports as effective.
// `RESERVED_BUSINESS_TEAM_PERMISSIONS` is what a role may still be CARRYING from
// before this split: those values stay in the row untouched, are reported
// separately as reserved, and are never counted by `hasPermission`. Delegating
// them needs the workspace-principal architecture deferred to Wave 2G-B, because
// every one of those domains keys its rows to an account id that is
// simultaneously the financial actor.
// ---------------------------------------------------------------------------

import type { BusinessTeamPermission, BusinessWorkspaceTier } from '@mohandishub/shared';

/** Every permission value the schema accepts. Mirrors the shared union exactly. */
export const ALL_BUSINESS_TEAM_PERMISSIONS: readonly BusinessTeamPermission[] = [
  'manage_team',
  'manage_services',
  'manage_jobs',
  'manage_reservations',
  'view_wallet',
  'manage_support_disputes',
  'view_analytics',
] as const;

/**
 * Permissions that a Wave 2G-A authorization decision actually reads.
 *
 * Grantable, and reported as effective. Adding to this list means adding an
 * enforcement point, not adding a checkbox.
 */
export const LAUNCH_BUSINESS_TEAM_PERMISSIONS: readonly BusinessTeamPermission[] = [
  'manage_team',
] as const;

/**
 * Permissions the schema stores but no endpoint enforces yet.
 *
 * Not grantable, not effective, and not deleted from any role that already has
 * one. They are surfaced under their own name so a workspace can see what a role
 * was configured with historically without being told it works.
 */
export const RESERVED_BUSINESS_TEAM_PERMISSIONS: readonly BusinessTeamPermission[] =
  ALL_BUSINESS_TEAM_PERMISSIONS.filter(
    (permission) => !LAUNCH_BUSINESS_TEAM_PERMISSIONS.includes(permission),
  );

export const isLaunchPermission = (permission: BusinessTeamPermission): boolean =>
  LAUNCH_BUSINESS_TEAM_PERMISSIONS.includes(permission);

/** Split a stored permission array into what is enforced and what is not. */
export const splitPermissions = (
  stored: readonly BusinessTeamPermission[],
): { effective: BusinessTeamPermission[]; reserved: BusinessTeamPermission[] } => ({
  effective: stored.filter(isLaunchPermission),
  reserved: stored.filter((permission) => !isLaunchPermission(permission)),
});

/** The value stored in `business_members.role` for the Admin tier. */
export const ADMIN_ROLE_KEY = 'manager';

/** Role keys that are seeded into every new workspace, in presentation order. */
export type BuiltInRoleSeed = {
  key: string;
  name: string;
  tier: BusinessWorkspaceTier;
  permissions: BusinessTeamPermission[];
};

// Seeded arrays carry only what is enforced. The earlier seeds handed Admin six
// permissions and Member three, none of which any endpoint read -- a workspace
// owner opening the role screen was shown a capability matrix that described
// nothing. Tier, not the permission array, is what separates Owner from Admin
// from Member today.
export const BUILT_IN_ROLE_SEEDS: readonly BuiltInRoleSeed[] = [
  {
    key: 'owner',
    name: 'Owner',
    tier: 'owner',
    permissions: [...LAUNCH_BUSINESS_TEAM_PERMISSIONS],
  },
  {
    // Stored as `manager`, presented as Admin. Team administration without any
    // ownership capability: the two are separated by tier, not by permissions,
    // so no permission array can be edited into ownership.
    key: ADMIN_ROLE_KEY,
    name: 'Admin',
    tier: 'admin',
    permissions: [...LAUNCH_BUSINESS_TEAM_PERMISSIONS],
  },
  {
    key: 'member',
    name: 'Member',
    tier: 'member',
    permissions: [],
  },
] as const;

/**
 * Built-in keys that exist in older workspaces but are no longer seeded or
 * offered. Their rows are left exactly where they are.
 */
export const LEGACY_BUILT_IN_ROLE_KEYS = new Set(['viewer']);

/**
 * Map a role to the tier a member holding it receives.
 *
 * This is the mirror of the `business_members_resolve_tier` trigger added in
 * 20260731120000, and the two must agree: the trigger decides what is stored,
 * this decides what is enforced in the request path. A custom role — anything
 * not built in — is always the member tier.
 */
export const tierForRole = (params: {
  roleKey: string | null;
  builtIn: boolean;
}): BusinessWorkspaceTier => {
  if (!params.builtIn || params.roleKey === null) return 'member';
  if (params.roleKey === 'owner') return 'owner';
  if (params.roleKey === ADMIN_ROLE_KEY || params.roleKey === 'admin') return 'admin';
  return 'member';
};

/** Map the stored `business_members.role` value onto a product tier. */
export const tierForStoredRole = (storedRole: string | null): BusinessWorkspaceTier => {
  if (storedRole === 'owner') return 'owner';
  if (storedRole === ADMIN_ROLE_KEY || storedRole === 'admin') return 'admin';
  return 'member';
};

/** Whether a built-in role key may still be handed out. */
export const isAssignableRole = (params: { roleKey: string | null; builtIn: boolean }): boolean => {
  if (!params.builtIn) return true;
  if (params.roleKey === null) return false;
  // Owner is never assignable through invitation or a role update, and while
  // ownership transfer is unavailable it is not assignable through anything.
  if (params.roleKey === 'owner') return false;
  return !LEGACY_BUILT_IN_ROLE_KEYS.has(params.roleKey);
};

/** How long an invitation stays usable. Bounded by a CHECK at 30 days. */
export const INVITE_TTL_DAYS = 7;

/**
 * A technical ceiling on workspace size, used only when the account's plan
 * configures no `maxTeamSlots` entitlement.
 *
 * Not a commercial tier and not a price boundary -- launch sells no team seats,
 * and inventing one here would be inventing a product. It exists so a single
 * workspace cannot be used as an unbounded invitation-email relay, and it is
 * high enough that no genuine team meets it.
 */
export const DEFAULT_TEAM_SEAT_CEILING = 50;
