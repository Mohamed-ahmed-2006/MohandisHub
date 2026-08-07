// ---------------------------------------------------------------------------
// Business Commercial Identity repository — reads only, and never a guess.
// ---------------------------------------------------------------------------
// Three lookups, one projection, and one rule that shapes all of them: a query
// here either matches exactly one identity or it reports that it did not. There
// is no `rows[0]`, no `LIMIT 1` over an unordered set and no "closest match".
// A duplicate or contradictory mapping is a distinct, named outcome — not the
// first row of a set that should have had one member.
//
// That distinction is the point. "This Business has no BCI" and "this Business
// has two, or has one whose owner disagrees with its mapping" demand opposite
// responses: the first is an ordinary absence, the second is a corrupt spine
// that must stop the request. Collapsing them into `null` is how a migration
// gap turns into an authorization decision made on the wrong row.
//
// The database already forbids every corrupt state this module reports —
// migration 20260806090000 holds them down with a primary key, a unique key, a
// deterministic CHECK and a composite foreign key. These reads assume none of
// it. A repository that only behaves while its constraints are intact is a
// repository that fails silently the one time they are not.
//
// `business_members` is deliberately absent from this file. Team membership
// administers a workspace; it confers no commercial identity, so it is not a
// term in any query here.
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { deterministicInitialIdentityId } from './business-identity.constants.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type BusinessIdentityStatus = 'active' | 'suspended' | 'archived';
export type BusinessIdentityOrigin = 'legacy_business_account' | 'native';

export type BusinessCommercialIdentity = {
  id: string;
  /** The canonical controlling account. The only source of commercial authority. */
  ownerUserId: string;
  status: BusinessIdentityStatus;
  origin: BusinessIdentityOrigin;
  createdAt: string;
  updatedAt: string;
};

/**
 * The legacy Business account this identity is the initial BCI for.
 *
 * Absent on a natively created identity, which has no legacy principal behind
 * it and must never be treated as though it does.
 */
export type BusinessIdentityLegacyAnchor = {
  businessAccountId: string;
} | null;

/**
 * Why a lookup refused to answer.
 *
 * `ownerUserId` is carried when the corrupt row still names an owner, so the
 * caller can decide whether this requester is entitled to hear that anything is
 * wrong at all.
 */
export type BusinessIdentityAmbiguity = {
  reason:
    | 'multiple_identities_resolved'
    | 'duplicate_legacy_mappings'
    | 'owner_mismatch'
    | 'orphan_initial_identity'
    // The mapping names an identity that is not the deterministic one for its
    // account, so the anchor cannot be the initial BCI it claims to be.
    | 'non_deterministic_anchor'
    // An identity carrying a legacy anchor while declaring native origin.
    | 'origin_conflict';
  ownerUserId: string | null;
};

export type BusinessIdentityResolution =
  | { kind: 'found'; identity: BusinessCommercialIdentity; legacy: BusinessIdentityLegacyAnchor }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; ambiguity: BusinessIdentityAmbiguity };

type IdentityRow = {
  id: string;
  owner_user_id: string;
  status: string;
  origin: string;
  created_at: Date;
  updated_at: Date;
  mapped_account_id: string | null;
  mapping_count: string;
};

// Every read selects the same shape, joined to the mapping so a corrupt anchor
// is visible in the same round trip that finds the identity. `created_by_migration`
// is never selected: it is internal provenance for an auditor with database
// access, and nothing above this layer has a reason to see it.
const IDENTITY_SELECT = `
  SELECT b.id,
         b.owner_user_id,
         b.status,
         b.origin,
         b.created_at,
         b.updated_at,
         m.business_account_id AS mapped_account_id,
         (SELECT count(*)
            FROM business_commercial_identity_legacy_map c
           WHERE c.bci_id = b.id)::text AS mapping_count
    FROM business_commercial_identities b
    LEFT JOIN business_commercial_identity_legacy_map m ON m.bci_id = b.id`;

const toIdentity = (row: IdentityRow): BusinessCommercialIdentity => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  status: row.status as BusinessIdentityStatus,
  origin: row.origin as BusinessIdentityOrigin,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/**
 * Turn a result set into a resolution.
 *
 * The corrupt cases are checked before the happy one, in the order that makes
 * the most specific complaint: more than one identity, more than one mapping,
 * an owner the mapping disagrees with, and a legacy identity with no mapping at
 * all. Only a set of exactly one internally consistent row is `found`.
 */
const interpret = (rows: IdentityRow[]): BusinessIdentityResolution => {
  if (rows.length === 0) return { kind: 'not_found' };

  const distinctIds = new Set(rows.map((row) => row.id));
  if (distinctIds.size > 1) {
    // A lookup that should name one identity named several — a Business
    // carrying two initial BCIs is exactly this shape. The owner is reported
    // only when every candidate agrees on it, so the account genuinely behind
    // the corruption hears about it and nobody else does.
    const owners = new Set(rows.map((row) => row.owner_user_id));
    return {
      kind: 'ambiguous',
      ambiguity: {
        reason: 'multiple_identities_resolved',
        ownerUserId: owners.size === 1 ? rows[0]!.owner_user_id : null,
      },
    };
  }

  const row = rows[0]!;

  // The join fans out on a duplicated mapping; the subquery counts it whether it
  // fanned out or not, so a mapping duplicated behind a different bci_id is
  // caught by the same test.
  if (rows.length > 1 || parseInt(row.mapping_count, 10) > 1) {
    return {
      kind: 'ambiguous',
      ambiguity: { reason: 'duplicate_legacy_mappings', ownerUserId: row.owner_user_id },
    };
  }

  if (row.mapped_account_id !== null && row.mapped_account_id !== row.owner_user_id) {
    return {
      kind: 'ambiguous',
      ambiguity: { reason: 'owner_mismatch', ownerUserId: row.owner_user_id },
    };
  }

  // An identity that claims to be a legacy Business's initial BCI, with no
  // legacy Business behind it. The compatibility anchor is the only thing that
  // makes that claim true, so without it the claim is not believed.
  if (row.origin === 'legacy_business_account' && row.mapped_account_id === null) {
    return {
      kind: 'ambiguous',
      ambiguity: { reason: 'orphan_initial_identity', ownerUserId: row.owner_user_id },
    };
  }

  return {
    kind: 'found',
    identity: toIdentity(row),
    legacy: row.mapped_account_id === null ? null : { businessAccountId: row.mapped_account_id },
  };
};

/**
 * Resolve a BCI by its own identifier.
 *
 * The identifier is not a credential and this function does not treat it as
 * one: it returns whatever it names, and the caller decides whether this
 * requester may have it. Authorization lives in the resolver, not here.
 */
export const resolveIdentityById = async (
  db: Queryable,
  identityId: string,
): Promise<BusinessIdentityResolution> => {
  const { rows } = await db.query<IdentityRow>(`${IDENTITY_SELECT} WHERE b.id = $1`, [identityId]);
  return interpret(rows);
};

/**
 * Resolve the initial BCI of a legacy Business account.
 *
 * Driven from the mapping rather than from `owner_user_id`, because the owner
 * column is not unique — one owner may control several BCIs, and only one of
 * them is the initial identity for that legacy Business.
 */
export const resolveInitialIdentityForBusinessAccount = async (
  db: Queryable,
  businessAccountId: string,
): Promise<BusinessIdentityResolution> => {
  const { rows } = await db.query<IdentityRow>(
    `${IDENTITY_SELECT}
      WHERE b.id IN (
        SELECT bci_id FROM business_commercial_identity_legacy_map
         WHERE business_account_id = $1
      )`,
    [businessAccountId],
  );
  return interpret(rows);
};

/**
 * Every BCI a given account controls, oldest first.
 *
 * Read from the ownership column alone. Two identities controlled by one person
 * appear as two rows and share nothing: no aggregate is computed here, and the
 * caller receives them separately for the same reason the product refuses to
 * roll them up.
 */
export const listIdentitiesControlledBy = async (
  db: Queryable,
  ownerUserId: string,
): Promise<BusinessCommercialIdentity[]> => {
  const { rows } = await db.query<IdentityRow>(
    `${IDENTITY_SELECT}
      WHERE b.owner_user_id = $1
      ORDER BY b.created_at ASC, b.id ASC`,
    [ownerUserId],
  );
  return rows.map(toIdentity);
};

/**
 * The Business profile a BCI resolves to, through its legacy anchor.
 *
 * Deliberately narrow. The legacy Business profile carries fields classified D3
 * — website, social links, premises address, contact details — and a second
 * route to them is a second place for that disclosure to be reopened. This
 * projection returns the identifiers needed to prove that a BCI-aware read and
 * a legacy read reach the SAME `business_profiles` row, plus the D0 company
 * name, and nothing else. Callers that need profile content keep using the
 * profiles module, which owns the field allowlist.
 */
export type BusinessIdentityProfileProjection = {
  identityId: string;
  /**
   * The legacy Business account, taken from the authoritative mapping — NOT
   * from the identity's owner column. The two agree for an initial BCI and are
   * validated against each other below; they are different facts, and reading
   * the wrong one is what let a native identity project a legacy profile.
   */
  businessAccountId: string;
  businessProfileId: string | null;
  companyName: string | null;
};

/**
 * Outcome of a legacy compatibility projection.
 *
 * `no_legacy_anchor` is an ordinary answer, not a failure: a natively created
 * BCI has no legacy Business behind it and therefore no legacy profile to
 * reach. An unknown identity resolves the same way, because in both cases the
 * honest answer is that no legacy Business is reachable through this identity.
 */
export type BusinessIdentityProfileResolution =
  | { kind: 'found'; projection: BusinessIdentityProfileProjection }
  | { kind: 'no_legacy_anchor' }
  | { kind: 'ambiguous'; ambiguity: BusinessIdentityAmbiguity };

/**
 * Project the legacy Business profile a BCI is the initial identity for.
 *
 * Legacy compatibility flows through the authoritative mapping in
 * `business_commercial_identity_legacy_map` and through nothing else. It is
 * deliberately NOT derived from ownership: one account may control several
 * BCIs, exactly one of which is the initial identity of its legacy Business, so
 * "same owner" and "same legacy Business" are different claims. Resolving the
 * profile from `owner_user_id` conflates them and lets a second, natively
 * created identity read the legacy Business's profile — the B5 isolation
 * failure this function exists to make impossible.
 *
 * The identity is resolved here rather than accepted as an argument, so the
 * anchor cannot be supplied by the caller. Four things must hold before a
 * single profile column is read:
 *
 *   1. the identity resolves cleanly — `resolveIdentityById` has already
 *      rejected duplicate mappings and orphaned initial identities;
 *   2. it carries an authoritative mapping row at all;
 *   3. that row names the identity's own owner;
 *   4. the mapped identity is THE deterministic identity for that account, and
 *      declares legacy origin.
 *
 * (4) is defence in depth over the database's own CHECK, not a replacement for
 * the persisted map: the map is read first and stays the trust boundary, and a
 * locally computed identifier is only ever used to CONTRADICT it, never to
 * stand in for it.
 */
export const projectLegacyBusinessProfile = async (
  db: Queryable,
  identityId: string,
): Promise<BusinessIdentityProfileResolution> => {
  const resolution = await resolveIdentityById(db, identityId);

  if (resolution.kind === 'not_found') return { kind: 'no_legacy_anchor' };
  if (resolution.kind === 'ambiguous') {
    return { kind: 'ambiguous', ambiguity: resolution.ambiguity };
  }

  const { identity, legacy } = resolution;

  // A natively created identity. Nothing is wrong with it; it simply is not any
  // legacy Business's initial BCI, so there is no legacy profile to project.
  if (legacy === null) return { kind: 'no_legacy_anchor' };

  const ambiguous = (
    reason: BusinessIdentityAmbiguity['reason'],
  ): BusinessIdentityProfileResolution => ({
    kind: 'ambiguous',
    ambiguity: { reason, ownerUserId: identity.ownerUserId },
  });

  // `interpret` already refuses this, and it is restated because THIS is the
  // read that turns an anchor into legacy data. A mapping that names one
  // account attached to an identity owned by another is the exact shape of a
  // cross-Business leak.
  if (legacy.businessAccountId !== identity.ownerUserId) return ambiguous('owner_mismatch');

  if (identity.id !== deterministicInitialIdentityId(legacy.businessAccountId)) {
    return ambiguous('non_deterministic_anchor');
  }

  if (identity.origin !== 'legacy_business_account') return ambiguous('origin_conflict');

  const { rows } = await db.query<{ id: string; company_name: string | null }>(
    `SELECT id, company_name FROM business_profiles WHERE user_id = $1`,
    [legacy.businessAccountId],
  );

  // `business_profiles.user_id` is UNIQUE, so more than one row cannot exist.
  // If it somehow does, the projection reports no profile rather than choosing
  // one — the same refusal to guess that governs every read above.
  const row = rows.length === 1 ? rows[0]! : null;

  return {
    kind: 'found',
    projection: {
      identityId: identity.id,
      businessAccountId: legacy.businessAccountId,
      businessProfileId: row?.id ?? null,
      companyName: row?.company_name ?? null,
    },
  };
};
