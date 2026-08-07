// ---------------------------------------------------------------------------
// Advertisement commercial authority — one question, one answer.
// ---------------------------------------------------------------------------
// "May this actor act commercially on this advertisement?" For a Business
// advertisement Wave 3 has exactly one affirmative answer — the account named in
// `business_commercial_identities.owner_user_id` for the identity that owns the
// campaign — and this file is where it is asked.
//
// Everything else is denied, including the things that look authoritative:
//
//   * an unrelated user;
//   * an ordinary member of the Business's workspace;
//   * a member holding `manage_team`, which administers a team and nothing else;
//   * a member whose role is labelled Admin, or stored as `manager`;
//   * a member carrying any of the six reserved permissions;
//   * a user who has merely SELECTED that Business's workspace;
//   * the same owner acting in the context of a DIFFERENT identity they control
//     — a natively created second BCI is a separate commercial identity, and it
//     does not own the first one's campaigns.
//
// The mechanism by which the first six are denied is that none of them is
// consulted. `business_members`, `business_team_roles`, `business_team_invites`
// and the workspace-selection state appear neither here nor in the resolver
// beneath. A permission cannot be wired to a decision that never reads it. The
// seventh is denied by the resolver, which resolves ownership through the
// authoritative legacy map instead of through "an identity this person owns".
//
// PLATFORM MODERATION IS SEPARATE AND STAYS SEPARATE. Approving, rejecting,
// pausing, scheduling and re-pricing a campaign are platform decisions gated by
// admin permissions on the admin routes; they do not pass through this file and
// they are not commercial authority. An administrator never becomes the
// Business, and there is no parameter here through which one could.
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { HttpError } from '../../utils/http-error.js';

import {
  resolveAdvertisementOwnership,
  type AdvertisementOwnershipAmbiguity,
  type AdvertisementOwnershipResolution,
} from './advertisement-ownership.repository.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * The two refusals every advertisement route already returns, reproduced
 * verbatim.
 *
 * This gate is additive: it must deny everything that is denied today with the
 * same status and the same code, or it is not a safety check but a behaviour
 * change wearing one. The only response it introduces is the 409 below, for a
 * state that could not previously exist.
 */
const notFound = (): HttpError =>
  new HttpError({
    statusCode: 404,
    code: 'AD_NOT_FOUND',
    message: 'Advertisement not found.',
  });

const notYours = (): HttpError =>
  new HttpError({
    statusCode: 403,
    code: 'FORBIDDEN',
    message: 'This ad does not belong to you.',
  });

/**
 * The ownership record contradicts itself for an advertisement this actor DOES
 * own.
 *
 * Raised only after the legacy advertiser has been matched, so a corrupt row
 * cannot be used to probe for existence. 409 rather than 500 because the request
 * is well formed and the data is not: retrying will not help, and an operator has
 * to reconcile it.
 */
const ownershipAmbiguous = (ambiguity: AdvertisementOwnershipAmbiguity): HttpError =>
  new HttpError({
    statusCode: 409,
    code: 'AD_OWNERSHIP_AMBIGUOUS',
    message:
      'This advertisement has an ambiguous or contradictory commercial owner and cannot be acted on until it is reconciled.',
    details: { reason: ambiguity.reason },
  });

/**
 * Gate a commercial action on an advertisement, and return who owns it.
 *
 * Called at the entry to every advertiser-initiated mutation. It does NOT
 * replace the ownership re-check each of those paths already performs inside the
 * transaction that locks the campaign: that check is the race-safe last word and
 * stays exactly where it is. This one adds what a bare `advertiser_id` comparison
 * cannot express — that ownership resolves to a commercial identity, and that a
 * row whose two statements of ownership contradict each other authorizes nothing
 * at all.
 *
 * The identity's `status` is returned rather than gated on. Wave 3 attaches no
 * advertisement consequence to a suspended or archived commercial identity;
 * inventing one here would be enforcement design, which belongs to the
 * suspension slice and not to an ownership migration.
 */
export const requireAdvertisementCommercialAuthority = async (
  db: Queryable,
  params: { advertisementId: string; actorUserId: string },
): Promise<AdvertisementOwnershipResolution> => {
  const resolution = await resolveAdvertisementOwnership(db, params.advertisementId);

  if (resolution.kind === 'not_found') throw notFound();

  if (resolution.kind === 'ambiguous') {
    // Corruption is reported only to the account the row names as advertiser.
    // To anybody else it is indistinguishable from a campaign they do not own,
    // which is what it is.
    if (resolution.ambiguity.legacyAdvertiserId !== params.actorUserId) throw notYours();
    throw ownershipAmbiguous(resolution.ambiguity);
  }

  if (resolution.kind === 'commercial_identity') {
    // The canonical controller of the OWNING identity. Not "an account that
    // controls some identity", and not the legacy advertiser column read on its
    // own — for every row the composite foreign key permits these are the same
    // account, and this is the one that stays correct if they ever are not.
    if (resolution.owner.identityOwnerUserId !== params.actorUserId) throw notYours();
    return resolution;
  }

  // Legacy compatibility. Preserved exactly as it authorizes today, because the
  // Personal Commercial Identity that will own these campaigns does not exist
  // yet and a stricter rule would deny an Expert their own advertisement.
  if (resolution.owner.legacyAdvertiserId !== params.actorUserId) throw notYours();
  return resolution;
};
