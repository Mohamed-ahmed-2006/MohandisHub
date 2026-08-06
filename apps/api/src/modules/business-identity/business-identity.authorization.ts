// ---------------------------------------------------------------------------
// Business Commercial Identity authorization — one question, one answer.
// ---------------------------------------------------------------------------
// "Is this actor the canonical controller of this BCI?" Wave 3 has exactly one
// affirmative answer to that question — the account named in
// `business_commercial_identities.owner_user_id` — and this file is where it is
// asked. Everything else is denied, including things that look authoritative:
//
//   * an unrelated user;
//   * an ordinary member of the Business's workspace;
//   * a member holding `manage_team`, which administers a team and nothing else;
//   * a member whose role is labelled Admin, or stored as `manager`;
//   * a member carrying any of the six reserved permissions, none of which is
//     read by any authorization decision;
//   * a user who has merely SELECTED that Business's workspace — selection
//     scopes team administration, never commercial context;
//   * a membership row that contradicts the ownership column, which is a
//     corrupt spine rather than a grant.
//
// The mechanism by which every one of those is denied is that none of them is
// consulted. `business_members`, `business_team_roles`, `business_team_invites`
// and the workspace-selection state do not appear in this module or in the
// repository beneath it. A permission cannot be wired to a decision that never
// reads it, which is what makes the Wave 4 boundary structural instead of
// remembered.
//
// There is no administrative bypass here either, and no parameter through which
// one could be added. Platform administrators inspect, annotate and enforce
// through the admin surfaces; they do not become the Business. Acting as the
// controller is exactly what an administrator must not be able to do silently.
//
// SCOPE. This is the compatibility boundary, not a conversion of the Business
// routes. Existing Business endpoints keep authorizing exactly as they do
// today; this resolver is introduced and proven so the next slice has one place
// to move them to.
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { HttpError } from '../../utils/http-error.js';

import {
  resolveIdentityById,
  resolveInitialIdentityForBusinessAccount,
  type BusinessIdentityAmbiguity,
  type BusinessIdentityStatus,
} from './business-identity.repository.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type BusinessIdentityContext = {
  /** The authenticated human making the request. */
  actorUserId: string;
  /** The BCI that was asked for. Asking is all it is. */
  identityId: string;
  /** The canonical owning Business account. */
  ownerUserId: string;
  status: BusinessIdentityStatus;
  /** True only when the actor IS the canonical owning account. */
  isCanonicalController: boolean;
  /**
   * The legacy Business account this identity is the initial BCI for, when it
   * is one. Null for a natively created identity.
   */
  legacyBusinessAccountId: string | null;
};

/**
 * A BCI that does not exist and a BCI that belongs to someone else are the same
 * refusal, deliberately. Distinguishing them would turn this endpoint into an
 * oracle for which identifiers are real, and the answer to both is identical:
 * this actor may not act commercially for that identity.
 */
const commercialAuthorityRequired = (): HttpError =>
  new HttpError({
    statusCode: 403,
    code: 'BCI_COMMERCIAL_AUTHORITY_REQUIRED',
    message: 'Only the controlling business account can act for this commercial identity.',
  });

/**
 * The spine is contradictory for an identity this actor DOES control.
 *
 * Raised only after control is established, so a corrupt row cannot be used to
 * probe for existence. It is a 409 rather than a 500 because the request is
 * well-formed and the data is not; retrying will not help, and an operator has
 * to reconcile it.
 */
const mappingAmbiguous = (ambiguity: BusinessIdentityAmbiguity): HttpError =>
  new HttpError({
    statusCode: 409,
    code: 'BCI_MAPPING_AMBIGUOUS',
    message:
      'This business commercial identity has an ambiguous or contradictory legacy mapping and cannot be used until it is reconciled.',
    details: { reason: ambiguity.reason },
  });

/**
 * Resolve the acting context for a named BCI.
 *
 * Returns a context for a caller who controls the identity, and throws for
 * everyone else. It never returns a context with `isCanonicalController: false`
 * — a non-controller has no commercial context to hold in Wave 3, and handing
 * one back would invite a caller to read the flag and carry on.
 */
export const resolveBusinessIdentityContext = async (
  db: Queryable,
  params: { actorUserId: string; identityId: string },
): Promise<BusinessIdentityContext> => {
  const resolution = await resolveIdentityById(db, params.identityId);

  if (resolution.kind === 'not_found') {
    throw commercialAuthorityRequired();
  }

  if (resolution.kind === 'ambiguous') {
    // Corruption is reported only to the account the corrupt row names as
    // owner. To anyone else it is indistinguishable from an identity they do
    // not control, which is what it is.
    if (resolution.ambiguity.ownerUserId !== params.actorUserId) {
      throw commercialAuthorityRequired();
    }
    throw mappingAmbiguous(resolution.ambiguity);
  }

  const { identity, legacy } = resolution;
  if (identity.ownerUserId !== params.actorUserId) {
    throw commercialAuthorityRequired();
  }

  return {
    actorUserId: params.actorUserId,
    identityId: identity.id,
    ownerUserId: identity.ownerUserId,
    status: identity.status,
    isCanonicalController: true,
    legacyBusinessAccountId: legacy?.businessAccountId ?? null,
  };
};

/**
 * Resolve an actor's own initial BCI, from their legacy Business account.
 *
 * The compatibility read: no identifier is supplied, so there is nothing to
 * widen. A caller who is not a legacy Business account simply has no initial
 * identity, and receives null rather than an error — that is an ordinary fact
 * about an ordinary account, not a failure.
 */
export const resolveOwnInitialBusinessIdentity = async (
  db: Queryable,
  actorUserId: string,
): Promise<BusinessIdentityContext | null> => {
  const resolution = await resolveInitialIdentityForBusinessAccount(db, actorUserId);

  if (resolution.kind === 'not_found') return null;

  if (resolution.kind === 'ambiguous') {
    if (resolution.ambiguity.ownerUserId !== actorUserId) {
      throw commercialAuthorityRequired();
    }
    throw mappingAmbiguous(resolution.ambiguity);
  }

  const { identity, legacy } = resolution;

  // The mapping is keyed by account, so this can only disagree if the composite
  // foreign key behind it has been removed. Checked anyway: a mapping that
  // names one account and an identity owned by another is the exact shape of a
  // cross-Business leak.
  if (identity.ownerUserId !== actorUserId) {
    throw mappingAmbiguous({ reason: 'owner_mismatch', ownerUserId: identity.ownerUserId });
  }

  return {
    actorUserId,
    identityId: identity.id,
    ownerUserId: identity.ownerUserId,
    status: identity.status,
    isCanonicalController: true,
    legacyBusinessAccountId: legacy?.businessAccountId ?? null,
  };
};

/**
 * Gate a commercial action on a resolved context.
 *
 * Control is necessary and not sufficient: an identity that is not `active`
 * holds no Wave 3 commercial authority either. The conservative reading is
 * deliberate — a suspended or archived identity acquiring authority by default
 * is the failure that is expensive, and narrowing this gate later is a smaller
 * change than discovering it was open.
 */
export const requireCommercialAuthority = (context: BusinessIdentityContext): void => {
  if (!context.isCanonicalController) {
    throw commercialAuthorityRequired();
  }
  if (context.status !== 'active') {
    throw new HttpError({
      statusCode: 403,
      code: 'BCI_NOT_ACTIVE',
      message: 'This business commercial identity is not active.',
    });
  }
};
