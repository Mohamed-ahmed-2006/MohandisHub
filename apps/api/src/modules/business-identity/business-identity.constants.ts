// ---------------------------------------------------------------------------
// Business Commercial Identity — the deterministic identifier, in TypeScript.
// ---------------------------------------------------------------------------
// A legacy Business account's INITIAL BCI id is a pure function of the account
// id. The database is where that function is authoritative — migration
// 20260806090000 defines it, a CHECK constraint on the mapping enforces it, and
// the backfill relies on it to converge under retry and under concurrency.
//
// This file mirrors it so the same value can be computed without a round trip:
// a test can state the expected id, and a caller can recognise an initial
// identity without asking. The two implementations MUST agree, which is why the
// namespace string is asserted against the migration's own text rather than
// copied and hoped about.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

/**
 * Fixed for the lifetime of the product.
 *
 * Changing it would give every existing Business a different initial BCI, which
 * is precisely the non-determinism the compatibility spine exists to prevent.
 * The identical constant lives in `business_commercial_identity_deterministic_id`.
 */
export const INITIAL_BCI_NAMESPACE = 'mohandishub:wave3:business-commercial-identity:initial:';

/** Keeps the low two bits, forces the high two — the RFC 4122 10xx variant. */
const VARIANT_NIBBLES = '89ab89ab89ab89ab';
const HEX_NIBBLES = '0123456789abcdef';

/**
 * The initial BCI id for a legacy Business account.
 *
 * RFC 4122 version 3 (name-based, MD5), so the value satisfies the UUID
 * validators already present in the request path and not merely PostgreSQL's
 * parser. MD5 is a name derivation over a primary key we already hold, not a
 * security primitive.
 */
export const deterministicInitialIdentityId = (businessAccountId: string): string => {
  const hex = createHash('md5')
    .update(`${INITIAL_BCI_NAMESPACE}${businessAccountId}`)
    .digest('hex');

  const version = `${hex.slice(0, 12)}3${hex.slice(13)}`;
  const variant = `${version.slice(0, 16)}${VARIANT_NIBBLES[HEX_NIBBLES.indexOf(version[16]!)]}${version.slice(17)}`;

  return [
    variant.slice(0, 8),
    variant.slice(8, 12),
    variant.slice(12, 16),
    variant.slice(16, 20),
    variant.slice(20, 32),
  ].join('-');
};

/** The migration that introduced the spine. Referenced by the tests that read it. */
export const BCI_COMPATIBILITY_MIGRATION =
  '20260806090000_business_commercial_identity_compatibility.sql';
