// ---------------------------------------------------------------------------
// Advertisement commercial ownership — the vocabulary, in one place.
// ---------------------------------------------------------------------------
// The column values below are the ones migration 20260807090000 constrains. They
// are named here rather than inlined so the resolver, the authorization gate and
// the tests all read the same words the database CHECK does.
// ---------------------------------------------------------------------------

/**
 * `advertisements.commercial_ownership_state` — the compatibility phase.
 *
 * `legacy_user_owned` is the pre-migration state and remains the correct state
 * for every personal provider until the PCI slice exists. It is not a failure.
 *
 * `quarantined_ambiguous` is an operator fence: a row whose ownership could not
 * be established and which must not act commercially until it is reconciled.
 * Resolution fails closed on it rather than falling back to the legacy owner.
 */
export type AdvertisementOwnershipState =
  | 'legacy_user_owned'
  | 'commercial_identity_owned'
  | 'quarantined_ambiguous';

/**
 * `advertisements.commercial_owner_kind` — the typed discriminator.
 *
 * Wave 3 admits exactly one value. The PCI slice widens both this union and the
 * database CHECK behind it; that is an additive change, which is the reason the
 * column is a discriminator rather than a free-text owner tag.
 */
export type AdvertisementCommercialOwnerKind = 'business';

/** The migration that introduced advertisement commercial ownership. */
export const ADVERTISEMENT_OWNERSHIP_MIGRATION =
  '20260807090000_advertisement_commercial_identity_ownership.sql';
