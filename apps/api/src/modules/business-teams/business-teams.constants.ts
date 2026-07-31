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

import type { BusinessTeamPermission, BusinessWorkspaceTier } from '@mohandishub/shared';

/** Every permission a role may carry. Mirrors the shared union exactly. */
export const ALL_BUSINESS_TEAM_PERMISSIONS: readonly BusinessTeamPermission[] = [
  'manage_team',
  'manage_services',
  'manage_jobs',
  'manage_reservations',
  'view_wallet',
  'manage_support_disputes',
  'view_analytics',
] as const;

/** The value stored in `business_members.role` for the Admin tier. */
export const ADMIN_ROLE_KEY = 'manager';

/** Role keys that are seeded into every new workspace, in presentation order. */
export type BuiltInRoleSeed = {
  key: string;
  name: string;
  tier: BusinessWorkspaceTier;
  permissions: BusinessTeamPermission[];
};

export const BUILT_IN_ROLE_SEEDS: readonly BuiltInRoleSeed[] = [
  {
    key: 'owner',
    name: 'Owner',
    tier: 'owner',
    permissions: [...ALL_BUSINESS_TEAM_PERMISSIONS],
  },
  {
    // Stored as `manager`, presented as Admin. Full operational administration
    // without any ownership capability: the two are separated by tier, not by
    // permissions, so no permission array can be edited into ownership.
    key: ADMIN_ROLE_KEY,
    name: 'Admin',
    tier: 'admin',
    permissions: [
      'manage_team',
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
    tier: 'member',
    permissions: ['manage_jobs', 'manage_reservations', 'view_analytics'],
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
  // Owner is never assignable through invitation or a role update. It moves
  // only through ownership transfer.
  if (params.roleKey === 'owner') return false;
  return !LEGACY_BUILT_IN_ROLE_KEYS.has(params.roleKey);
};

/** How long an invitation stays usable. Bounded by a CHECK at 30 days. */
export const INVITE_TTL_DAYS = 7;
