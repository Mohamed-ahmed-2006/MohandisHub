// ---------------------------------------------------------------------------
// Who owns an advertisement — the dual read, and its refusal to guess.
// ---------------------------------------------------------------------------
// One advertisement, two possible statements of ownership: the canonical
// commercial identity recorded by migration 20260807090000, and the legacy
// `advertiser_id` that has always been there. This module answers with one, in
// this order:
//
//   1. A canonical commercial identity, when the row carries one AND every
//      claim it makes survives validation.
//   2. Otherwise, while legacy compatibility is still permitted, the commercial
//      identity the LEGACY anchor resolves to — a legacy Business account's
//      authoritative initial BCI, read from
//      `business_commercial_identity_legacy_map`.
//   3. Otherwise the legacy user owner, unchanged, which is the correct and
//      only available answer for a personal provider until the PCI slice.
//
// Step 2 is the compatibility read, and it is deliberately NOT a fallback for a
// failed step 1. A canonical owner that is present but invalid — an identity
// belonging to somebody else, an identity that does not exist, a second identity
// the same owner created natively, a state column that contradicts the columns
// beside it — is a CONTRADICTION, and a contradiction stops the request. Falling
// through to the legacy owner there would be exactly the silent substitution
// this slice exists to prevent: the row says one thing, the request would act on
// another.
//
// The order also settles the agreement case without a special branch. When the
// assigned identity and the legacy anchor name the same BCI — which is the only
// shape the composite foreign key allows — steps 1 and 2 produce the same
// answer, so "they agree" is not a state anybody has to detect.
//
// `business_members`, `business_team_roles` and the workspace-selection state do
// not appear in this file. Advertisement ownership is not delegable in Wave 3,
// and the mechanism by which it is not delegable is that no membership row is a
// term in any query here.
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { deterministicInitialIdentityId } from '../business-identity/business-identity.constants.js';
import type { BusinessIdentityStatus } from '../business-identity/business-identity.repository.js';

import type {
  AdvertisementCommercialOwnerKind,
  AdvertisementOwnershipState,
} from './advertisement-ownership.constants.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * How the owning commercial identity was reached.
 *
 * `assigned` — the advertisement's own `business_commercial_identity_id`.
 * `legacy_compatibility` — the advertiser's authoritative initial BCI, for a row
 * the backfill has not reached yet. Both are the same identity for any row the
 * migration has touched; the distinction is kept because "the asset says so" and
 * "the compatibility map says so" are different facts, and an operator
 * reconciling the table needs to know which one answered.
 */
export type AdvertisementOwnershipSource = 'assigned' | 'legacy_compatibility';

/** Ownership resolved to a commercial identity. */
export type AdvertisementCommercialOwner = {
  advertisementId: string;
  /** Never dropped. The legacy anchor stays readable for the whole of Wave 3. */
  legacyAdvertiserId: string;
  ownerKind: AdvertisementCommercialOwnerKind;
  identityId: string;
  /** The canonical controller of the identity — the only commercial authority. */
  identityOwnerUserId: string;
  identityStatus: BusinessIdentityStatus;
  ownershipState: AdvertisementOwnershipState;
  source: AdvertisementOwnershipSource;
};

/**
 * Why no commercial identity is reachable.
 *
 * Both values are ordinary facts about a correct database, not defects.
 * `awaiting_personal_commercial_identity` is every Expert and Craftsman campaign
 * until the PCI slice ships. `no_business_commercial_identity` is a Business
 * account that has no mapping row — a Business registered after the spine
 * migration ran, whose advertisements must keep working on the legacy anchor
 * rather than be fenced for a gap they did not cause.
 */
export type AdvertisementLegacyOwnerReason =
  | 'awaiting_personal_commercial_identity'
  | 'no_business_commercial_identity';

/** Ownership still resolved through the legacy account, correctly. */
export type AdvertisementLegacyOwner = {
  advertisementId: string;
  legacyAdvertiserId: string;
  advertiserRole: string;
  ownershipState: AdvertisementOwnershipState;
  reason: AdvertisementLegacyOwnerReason;
};

/**
 * Why ownership could not be stated.
 *
 * `legacyAdvertiserId` is carried so the caller can decide who is entitled to
 * hear that anything is wrong: a corrupt row is reported to the account it names
 * as advertiser and to nobody else.
 */
export type AdvertisementOwnershipAmbiguity = {
  reason: // The assigned identity belongs to a different account. A cross-Business
    // leak, refused before it can authorize anything.
    | 'owner_mismatch'
    // The assigned identity is not this advertiser's authoritative initial BCI:
    // a second identity the same owner created natively, or an identity the map
    // does not anchor. Same-owner is not the same claim as same-Business.
    | 'non_authoritative_identity'
    // The assigned identity does not exist at all.
    | 'unknown_identity'
    // An identity anchored as a legacy initial BCI that does not declare legacy
    // origin.
    | 'origin_conflict'
    // The state column and the ownership columns disagree.
    | 'state_conflict'
    // More than one mapping row resolves for this advertiser.
    | 'duplicate_legacy_mappings'
    // Fenced by an operator. Deliberately not repairable by a read.
    | 'quarantined';
  legacyAdvertiserId: string;
};

export type AdvertisementOwnershipResolution =
  | { kind: 'not_found' }
  | { kind: 'commercial_identity'; owner: AdvertisementCommercialOwner }
  | { kind: 'legacy_user'; owner: AdvertisementLegacyOwner }
  | { kind: 'ambiguous'; ambiguity: AdvertisementOwnershipAmbiguity };

type OwnershipRow = {
  id: string;
  advertiser_id: string;
  commercial_owner_kind: string | null;
  business_commercial_identity_id: string | null;
  commercial_ownership_state: string;
  advertiser_role: string;
  identity_id: string | null;
  identity_owner_user_id: string | null;
  identity_status: string | null;
  identity_origin: string | null;
  /** The map row anchoring the ASSIGNED identity, if any. */
  assigned_anchor_account_id: string | null;
  /** The map row anchoring the ADVERTISER — their authoritative initial BCI. */
  advertiser_initial_identity_id: string | null;
  advertiser_initial_identity_status: string | null;
  advertiser_initial_identity_origin: string | null;
  advertiser_mapping_count: string;
};

/**
 * One round trip. Both anchors, the identity and the advertiser's role together,
 * because resolving them in separate queries would let the row change between
 * them and turn a consistent refusal into an inconsistent answer.
 */
const OWNERSHIP_SELECT = `
  SELECT a.id,
         a.advertiser_id,
         a.commercial_owner_kind,
         a.business_commercial_identity_id,
         a.commercial_ownership_state,
         u.primary_role                     AS advertiser_role,
         assigned.id                        AS identity_id,
         assigned.owner_user_id             AS identity_owner_user_id,
         assigned.status                    AS identity_status,
         assigned.origin                    AS identity_origin,
         assigned_map.business_account_id   AS assigned_anchor_account_id,
         own_map.bci_id                     AS advertiser_initial_identity_id,
         own_identity.status                AS advertiser_initial_identity_status,
         own_identity.origin                AS advertiser_initial_identity_origin,
         (SELECT count(*)
            FROM business_commercial_identity_legacy_map c
           WHERE c.business_account_id = a.advertiser_id)::text AS advertiser_mapping_count
    FROM advertisements a
    JOIN users u ON u.id = a.advertiser_id
    LEFT JOIN business_commercial_identities assigned
           ON assigned.id = a.business_commercial_identity_id
    LEFT JOIN business_commercial_identity_legacy_map assigned_map
           ON assigned_map.bci_id = a.business_commercial_identity_id
    LEFT JOIN business_commercial_identity_legacy_map own_map
           ON own_map.business_account_id = a.advertiser_id
    LEFT JOIN business_commercial_identities own_identity
           ON own_identity.id = own_map.bci_id`;

/** Roles whose advertisements will be re-associated by the PCI slice, not this one. */
const PERSONAL_PROVIDER_ROLES = new Set(['expert', 'craftsman']);

const interpret = (rows: OwnershipRow[]): AdvertisementOwnershipResolution => {
  if (rows.length === 0) return { kind: 'not_found' };

  // The joins are all to unique keys, so a second row can only mean the mapping
  // has been duplicated behind them. Reported rather than resolved by taking the
  // first, which is the whole reason this module has no `rows[0]`.
  const row = rows[0]!;
  const ambiguous = (
    reason: AdvertisementOwnershipAmbiguity['reason'],
  ): AdvertisementOwnershipResolution => ({
    kind: 'ambiguous',
    ambiguity: { reason, legacyAdvertiserId: row.advertiser_id },
  });

  if (rows.length > 1 || parseInt(row.advertiser_mapping_count, 10) > 1) {
    return ambiguous('duplicate_legacy_mappings');
  }

  const state = row.commercial_ownership_state as AdvertisementOwnershipState;

  // Checked first: a fenced row is fenced whatever its columns say, and reading
  // further would be reading a row an operator has already declared unusable.
  if (state === 'quarantined_ambiguous') return ambiguous('quarantined');

  const assignedId = row.business_commercial_identity_id;

  // -------------------------------------------------------------------------
  // 1. The canonical owner the advertisement itself names.
  // -------------------------------------------------------------------------
  if (assignedId !== null) {
    if (row.commercial_owner_kind !== 'business' || state !== 'commercial_identity_owned') {
      return ambiguous('state_conflict');
    }
    if (row.identity_id === null) return ambiguous('unknown_identity');
    if (row.identity_owner_user_id !== row.advertiser_id) return ambiguous('owner_mismatch');

    // The persisted map is the trust boundary, and it is consulted from BOTH
    // directions: the assigned identity must be anchored to this advertiser, and
    // this advertiser's anchor must be that identity. A natively created second
    // identity of the same owner fails the first test; an advertisement pointed
    // at some other mapped identity fails the second.
    if (row.assigned_anchor_account_id !== row.advertiser_id) {
      return ambiguous('non_authoritative_identity');
    }
    if (row.advertiser_initial_identity_id !== assignedId) {
      return ambiguous('non_authoritative_identity');
    }
    // Defence in depth over the database's own CHECK, mirroring the BCI
    // repository: the locally computed identifier is only ever used to
    // CONTRADICT the persisted map, never to stand in for it.
    if (assignedId !== deterministicInitialIdentityId(row.advertiser_id)) {
      return ambiguous('non_authoritative_identity');
    }
    if (row.identity_origin !== 'legacy_business_account') return ambiguous('origin_conflict');

    return {
      kind: 'commercial_identity',
      owner: {
        advertisementId: row.id,
        legacyAdvertiserId: row.advertiser_id,
        ownerKind: 'business',
        identityId: assignedId,
        identityOwnerUserId: row.identity_owner_user_id,
        identityStatus: row.identity_status as BusinessIdentityStatus,
        ownershipState: state,
        source: 'assigned',
      },
    };
  }

  // A row with no assigned identity may not claim to have one.
  if (row.commercial_owner_kind !== null || state !== 'legacy_user_owned') {
    return ambiguous('state_conflict');
  }

  // -------------------------------------------------------------------------
  // 2. The compatibility read: the identity the LEGACY anchor resolves to.
  // -------------------------------------------------------------------------
  // Not a fallback from a failed step 1 — step 1 did not fail, it was absent.
  // This is the rule that keeps an un-backfilled Business campaign owned by the
  // right commercial identity rather than by an account.
  const initialIdentityId = row.advertiser_initial_identity_id;
  if (initialIdentityId !== null) {
    if (initialIdentityId !== deterministicInitialIdentityId(row.advertiser_id)) {
      return ambiguous('non_authoritative_identity');
    }
    if (row.advertiser_initial_identity_origin !== 'legacy_business_account') {
      return ambiguous('origin_conflict');
    }

    return {
      kind: 'commercial_identity',
      owner: {
        advertisementId: row.id,
        legacyAdvertiserId: row.advertiser_id,
        ownerKind: 'business',
        identityId: initialIdentityId,
        // The map's composite foreign key makes the anchored account the
        // identity's owner, so the advertiser IS the canonical controller.
        identityOwnerUserId: row.advertiser_id,
        identityStatus: row.advertiser_initial_identity_status as BusinessIdentityStatus,
        ownershipState: state,
        source: 'legacy_compatibility',
      },
    };
  }

  // -------------------------------------------------------------------------
  // 3. Legacy user ownership, which is still the right answer for some rows.
  // -------------------------------------------------------------------------
  return {
    kind: 'legacy_user',
    owner: {
      advertisementId: row.id,
      legacyAdvertiserId: row.advertiser_id,
      advertiserRole: row.advertiser_role,
      ownershipState: state,
      reason: PERSONAL_PROVIDER_ROLES.has(row.advertiser_role)
        ? 'awaiting_personal_commercial_identity'
        : 'no_business_commercial_identity',
    },
  };
};

/** Resolve one advertisement's commercial owner. */
export const resolveAdvertisementOwnership = async (
  db: Queryable,
  advertisementId: string,
): Promise<AdvertisementOwnershipResolution> => {
  const { rows } = await db.query<OwnershipRow>(`${OWNERSHIP_SELECT} WHERE a.id = $1`, [
    advertisementId,
  ]);
  return interpret(rows);
};

/**
 * The account that holds commercial authority over a resolved advertisement.
 *
 * One function so there is one answer. For an identity-owned advertisement it is
 * the identity's canonical controller; for a legacy-owned one it is the legacy
 * advertiser, which is the authorized behaviour being preserved unchanged until
 * the PCI slice. An ambiguous or unknown advertisement has no authorized account
 * at all, and says so rather than naming a plausible one.
 */
export const commercialControllerOf = (
  resolution: AdvertisementOwnershipResolution,
): string | null => {
  if (resolution.kind === 'commercial_identity') return resolution.owner.identityOwnerUserId;
  if (resolution.kind === 'legacy_user') return resolution.owner.legacyAdvertiserId;
  return null;
};
