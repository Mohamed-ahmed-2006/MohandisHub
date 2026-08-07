// ---------------------------------------------------------------------------
// Every Business gets its initial BCI, at the moment it becomes a Business.
// ---------------------------------------------------------------------------
// Migration 20260806090000 minted the initial identity for every Business that
// existed when it ran. It could not mint one for a Business created afterwards,
// and nothing did — so a Business registered after the spine shipped stayed in
// legacy compatibility mode, owning its assets through an account rather than
// through a commercial identity. That gap is closed here, at runtime, by the
// same deterministic rule the migration used.
//
// THE RULE IS NOT RE-IMPLEMENTED. `deterministicInitialIdentityId` is imported
// from the BCI foundation, which is the same function the migration's CHECK
// constraint enforces in the database. A second generator would be a second
// answer to "which identity is this Business's initial one", and the entire
// compatibility spine depends on there being exactly one.
//
// ATOMICITY. This operation never opens a transaction of its own. It runs on
// the caller's client, inside the transaction that establishes the Business
// account, so a Business row and its identity commit together or not at all.
// A background job, a retry queue or an after-response hook would each permit a
// committed Business with no identity — which is the state this exists to make
// impossible, not the state it exists to clean up afterwards.
//
// CONVERGENCE, NOT REPAIR. Both inserts are `ON CONFLICT DO NOTHING` against
// keys whose values are fully determined by the account id, so a retry, a
// concurrent signup and a re-run all settle on the same two rows without a lock,
// a loop or a swallowed error. What this will NOT do is repair a contradiction:
// an identity at the deterministic id owned by somebody else, or declaring
// native origin, or a mapping naming a different identity, is reported under its
// own name and the caller's transaction fails. Minting a second identity to work
// around a corrupt first one is exactly how one Business acquires two.
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { HttpError } from '../../utils/http-error.js';

import { deterministicInitialIdentityId } from './business-identity.constants.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * What provisioning actually did.
 *
 * `reused` is the ordinary answer on every path that runs more than once, and it
 * is a success: the identity that should exist does exist. `mapping_completed`
 * is the one narrow repair this operation performs — see the note on it below.
 */
export type InitialIdentityProvisionOutcome = 'created' | 'reused' | 'mapping_completed';

export type ProvisionedInitialIdentity = {
  identityId: string;
  ownerUserId: string;
  outcome: InitialIdentityProvisionOutcome;
  /** Never rewritten by a re-run. Returned so a retry can be proved inert. */
  createdAt: string;
};

/**
 * Why provisioning refused.
 *
 * Every one of these is a state the database already forbids. They are checked
 * anyway, and named separately, because an operation that only behaves while its
 * constraints are intact behaves wrongly the one time they are not — and because
 * "this Business has a corrupt identity" and "this Business has no identity"
 * demand opposite responses.
 */
export type InitialIdentityProvisionFailure =
  /** The account does not exist, or is not a Business principal. */
  | 'not_a_business_account'
  /** The deterministic identity exists and belongs to a different account. */
  | 'owner_mismatch'
  /** It exists, is owned by this account, and does not declare legacy origin. */
  | 'origin_conflict'
  /** A mapping exists for this account naming an identity that is not the deterministic one. */
  | 'non_deterministic_mapping'
  /** A mapping exists naming an identity that does not. */
  | 'mapping_identity_missing'
  /** More than one mapping resolves for this account. */
  | 'duplicate_legacy_mappings';

/**
 * A 409 rather than a 500: the request is well formed and the spine is not.
 * Retrying will not help, and an operator has to reconcile it. The reason is
 * carried in `details` so a caller can distinguish "no identity yet" from
 * "an identity that contradicts this Business", which are not the same problem.
 */
const provisioningFailed = (
  reason: InitialIdentityProvisionFailure,
  businessAccountId: string,
): HttpError =>
  new HttpError({
    statusCode: 409,
    code: 'BCI_PROVISIONING_FAILED',
    message:
      'This business account could not be given its commercial identity because the existing identity records contradict it.',
    details: { reason, businessAccountId },
  });

type SpineRow = {
  identity_id: string | null;
  identity_owner: string | null;
  identity_origin: string | null;
  identity_created_at: Date | null;
  mapped_identity_id: string | null;
  mapping_count: string;
};

/**
 * The identity at the deterministic id and the mapping for this account, in one
 * round trip.
 *
 * Read together deliberately: resolving them in two queries would let the state
 * change between them and turn a consistent refusal into an inconsistent one.
 * The identity is looked up by the DETERMINISTIC id rather than by owner,
 * because one owner may control several identities and only one of them is this
 * Business's initial one.
 */
const SPINE_SELECT = `
  SELECT b.id            AS identity_id,
         b.owner_user_id AS identity_owner,
         b.origin        AS identity_origin,
         b.created_at    AS identity_created_at,
         m.bci_id        AS mapped_identity_id,
         (SELECT count(*)
            FROM business_commercial_identity_legacy_map c
           WHERE c.business_account_id = $2)::text AS mapping_count
    FROM (SELECT 1) anchor
    LEFT JOIN business_commercial_identities b
           ON b.id = $1
    LEFT JOIN business_commercial_identity_legacy_map m
           ON m.business_account_id = $2`;

/**
 * Refuse every contradictory shape, in the order that makes the most specific
 * complaint. Returns nothing; it throws or it is silent.
 */
const assertSpineIsConsistent = (
  row: SpineRow,
  params: { businessAccountId: string; expectedIdentityId: string },
): void => {
  const fail = (reason: InitialIdentityProvisionFailure): never => {
    throw provisioningFailed(reason, params.businessAccountId);
  };

  // Held down by the mapping's primary key. Asserted because "one Business, one
  // initial identity" is the whole claim the spine makes.
  if (parseInt(row.mapping_count, 10) > 1) fail('duplicate_legacy_mappings');

  if (row.mapped_identity_id !== null && row.mapped_identity_id !== params.expectedIdentityId) {
    // The account is anchored to something that is not its deterministic
    // identity. Held down by a CHECK constraint; a second identity is NOT the
    // answer to it.
    fail('non_deterministic_mapping');
  }

  if (row.identity_id !== null) {
    // Same identifier, different Business. The exact shape of a cross-Business
    // leak, refused before anything is written.
    if (row.identity_owner !== params.businessAccountId) fail('owner_mismatch');
    // An identity sitting on the deterministic identifier while declaring it was
    // created natively cannot be this Business's legacy initial identity, and
    // must not be adopted as one.
    if (row.identity_origin !== 'legacy_business_account') fail('origin_conflict');
  } else if (row.mapped_identity_id !== null) {
    // Anchored to the right identifier, but nothing is there. Held down by the
    // mapping's composite foreign key.
    fail('mapping_identity_missing');
  }
};

/**
 * Give a Business account its initial Business Commercial Identity.
 *
 * Runs on the CALLER'S client, inside the caller's transaction. Returns the
 * authoritative identity whether it minted one or found one, and throws rather
 * than returning anything at all when the records contradict this Business —
 * which, on a creation path, rolls the Business back with it.
 *
 * `deleted_at` and `is_active` are deliberately not filtered. Migration
 * 20260806090000 included deactivated Business accounts on purpose — a BCI is a
 * commercial identity with its own lifecycle column, `is_active` is a login
 * fact, and conflating them would leave a reactivated Business without the
 * identity its assets hang off. Runtime provisioning converges on the same
 * population for the same reason.
 */
export const ensureInitialBusinessCommercialIdentity = async (
  db: Queryable,
  businessAccountId: string,
): Promise<ProvisionedInitialIdentity> => {
  const expectedIdentityId = deterministicInitialIdentityId(businessAccountId);

  // The Business-only path is Business-only. A Customer, Expert or Craftsman
  // account reaching this function is a wiring mistake, and minting them a
  // Business identity would be a worse answer than refusing.
  const { rows: accountRows } = await db.query<{ primary_role: string }>(
    `SELECT primary_role FROM users WHERE id = $1`,
    [businessAccountId],
  );
  if (accountRows.length !== 1 || accountRows[0]!.primary_role !== 'business') {
    throw provisioningFailed('not_a_business_account', businessAccountId);
  }

  const before = await db.query<SpineRow>(SPINE_SELECT, [expectedIdentityId, businessAccountId]);
  const existing = before.rows[0]!;
  assertSpineIsConsistent(existing, { businessAccountId, expectedIdentityId });

  // Nothing to do, and nothing written — including `created_at`, which a re-run
  // must not move.
  if (existing.identity_id !== null && existing.mapped_identity_id !== null) {
    return {
      identityId: expectedIdentityId,
      ownerUserId: businessAccountId,
      outcome: 'reused',
      createdAt: existing.identity_created_at!.toISOString(),
    };
  }

  // The deterministic id is the primary key, so a concurrent transaction that
  // got here first is arbitrated by the key: the loser's INSERT waits for the
  // winner, then does nothing, and the read below sees the winner's row. No
  // advisory lock, no retry loop, and no duplicate to swallow.
  if (existing.identity_id === null) {
    await db.query(
      `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
       VALUES ($1, $2, 'active', 'legacy_business_account')
       ON CONFLICT (id) DO NOTHING`,
      [expectedIdentityId, businessAccountId],
    );
  }

  // The same arbitration on the mapping's own primary key. `created_by_migration`
  // is false: this row came from the request path, and the provenance of the two
  // populations stays distinguishable to an auditor.
  //
  // Reached on its own when the identity already existed and its anchor did not.
  // Completing it is safe precisely because nothing is chosen: the mapping is a
  // pure function of the account, and the checks above have already proved the
  // identity at that identifier is owned by this Business and declares legacy
  // origin. The database re-proves both — a deterministic CHECK and a composite
  // foreign key to `(id, owner_user_id)` — so a mapping that should not exist
  // cannot be written even if this reasoning were wrong.
  await db.query(
    `INSERT INTO business_commercial_identity_legacy_map
       (business_account_id, bci_id, created_by_migration)
     VALUES ($1, $2, false)
     ON CONFLICT (business_account_id) DO NOTHING`,
    [businessAccountId, expectedIdentityId],
  );

  // Read back and re-prove. A concurrent writer inserts the identical values, so
  // this normally just confirms; it is here so that a state this function did
  // not expect fails the transaction rather than being returned as a success.
  const after = await db.query<SpineRow>(SPINE_SELECT, [expectedIdentityId, businessAccountId]);
  const settled = after.rows[0]!;
  assertSpineIsConsistent(settled, { businessAccountId, expectedIdentityId });

  if (settled.identity_id === null || settled.mapped_identity_id === null) {
    throw provisioningFailed('mapping_identity_missing', businessAccountId);
  }

  return {
    identityId: expectedIdentityId,
    ownerUserId: businessAccountId,
    outcome: existing.identity_id === null ? 'created' : 'mapping_completed',
    createdAt: settled.identity_created_at!.toISOString(),
  };
};
