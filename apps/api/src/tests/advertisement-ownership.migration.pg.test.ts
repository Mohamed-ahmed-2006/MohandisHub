// ---------------------------------------------------------------------------
// The advertisement ownership migration, against a REAL PostgreSQL.
// ---------------------------------------------------------------------------
// Every claim this slice makes is a claim about what the database refuses, and a
// mocked pool refuses nothing. These are the properties that need a server:
//
//   * a Business advertisement really is re-associated to its advertiser's
//     authoritative initial BCI, computed by PostgreSQL and by Node alike;
//   * a same-owner NATIVE identity cannot take it, because the composite key
//     targets the legacy map and a native identity is never mapped;
//   * another Business's identity cannot take it either;
//   * a personal provider's campaign comes out of the migration untouched;
//   * a second run assigns nothing, and a partially applied run can be retried;
//   * every advertisement id, billing figure, moderation decision and renewal
//     counter is byte-identical afterwards;
//   * an assigned owner cannot be re-pointed or cleared;
//   * ambiguous data stops the migration before it writes anything.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ADVERTISEMENT_OWNERSHIP_MIGRATION } from '../modules/advertisements/advertisement-ownership.constants.js';
import { deterministicInitialIdentityId } from '../modules/business-identity/business-identity.constants.js';

import {
  countRows,
  createScratchDatabase,
  pgIntegrationEnabled,
  readMigration,
  type ScratchDatabase,
} from './support/pg-scratch.js';

let scratch: ScratchDatabase;
let pool: Pool;

/** The reversal documented in this migration's own header. */
const ROLLBACK_SQL = `
DROP TRIGGER IF EXISTS trg_advertisements_immutable_commercial_owner ON public.advertisements;
DROP FUNCTION IF EXISTS public.advertisements_reject_commercial_owner_change();
DROP INDEX IF EXISTS public.idx_advertisements_commercial_identity;
DROP INDEX IF EXISTS public.idx_advertisements_ownership_unresolved;
ALTER TABLE public.advertisements
  DROP CONSTRAINT IF EXISTS fk_advertisements_business_identity_anchor,
  DROP CONSTRAINT IF EXISTS chk_advertisements_commercial_owner_kind,
  DROP CONSTRAINT IF EXISTS chk_advertisements_ownership_state_pairing,
  DROP COLUMN IF EXISTS commercial_owner_kind,
  DROP COLUMN IF EXISTS business_commercial_identity_id,
  DROP COLUMN IF EXISTS commercial_ownership_state,
  DROP COLUMN IF EXISTS commercial_ownership_assigned_at;
ALTER TABLE public.business_commercial_identity_legacy_map
  DROP CONSTRAINT IF EXISTS uq_business_commercial_identity_legacy_map_anchor;
`;

/** The BCI spine, so a rolled-back state can be rebuilt from either end. */
const BCI_MIGRATION = '20260806090000_business_commercial_identity_compatibility.sql';

let seq = 0;

const seedUser = async (role: string): Promise<string> => {
  seq += 1;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, primary_role, email_verified_at)
     VALUES ($1, 'x', $2, $3, now())
     RETURNING id`,
    [`adown${seq}-${Date.now().toString(36)}@test.local`, `User ${seq}`, role],
  );
  return rows[0]!.id;
};

/**
 * One campaign, with the columns the legacy CHECK constraints demand.
 *
 * `link_type = 'profile'` with `destination_provider_id = advertiser` is the
 * only shape `advertisements_destination_check` accepts for a non-cancelled row.
 */
const seedAd = async (
  advertiserId: string,
  overrides: { status?: string; billingStatus?: string; amountPaid?: string } = {},
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO advertisements (
       advertiser_id, title_en, image_url, link_type, destination_provider_id,
       status, billing_model, billing_status, amount_paid, duration_days, renewal_count
     ) VALUES ($1, $2, 'https://cdn.example/a.png', 'profile', $1, $3, 'weekly', $4, $5, 7, 3)
     RETURNING id`,
    [
      advertiserId,
      `Campaign ${(seq += 1)}`,
      overrides.status ?? 'active',
      overrides.billingStatus ?? 'active',
      overrides.amountPaid ?? '0',
    ],
  );
  return rows[0]!.id;
};

/** A natively created second identity for an owner who already has an initial one. */
const seedNativeIdentity = async (ownerUserId: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
     VALUES (gen_random_uuid(), $1, 'active', 'native')
     RETURNING id`,
    [ownerUserId],
  );
  return rows[0]!.id;
};

const ownershipOf = async (
  adId: string,
): Promise<{
  kind: string | null;
  identity: string | null;
  state: string;
  assignedAt: string | null;
}> => {
  const { rows } = await pool.query<{
    commercial_owner_kind: string | null;
    business_commercial_identity_id: string | null;
    commercial_ownership_state: string;
    commercial_ownership_assigned_at: string | null;
  }>(
    `SELECT commercial_owner_kind, business_commercial_identity_id,
            commercial_ownership_state, commercial_ownership_assigned_at
       FROM advertisements WHERE id = $1`,
    [adId],
  );
  const row = rows[0]!;
  return {
    kind: row.commercial_owner_kind,
    identity: row.business_commercial_identity_id,
    state: row.commercial_ownership_state,
    assignedAt: row.commercial_ownership_assigned_at,
  };
};

/** Try to record a commercial owner directly, the way only the API may. */
const assign = (adId: string, identityId: string) =>
  pool.query(
    `UPDATE advertisements
        SET commercial_owner_kind = 'business',
            business_commercial_identity_id = $2,
            commercial_ownership_state = 'commercial_identity_owned',
            commercial_ownership_assigned_at = now()
      WHERE id = $1`,
    [adId, identityId],
  );

/** Every legacy column of every advertisement, so "unchanged" is checkable. */
const legacySnapshot = async (): Promise<string> => {
  const { rows } = await pool.query<{ snapshot: string }>(
    `SELECT coalesce(
              jsonb_agg(
                to_jsonb(a) - 'commercial_owner_kind'
                            - 'business_commercial_identity_id'
                            - 'commercial_ownership_state'
                            - 'commercial_ownership_assigned_at'
                ORDER BY a.id
              ),
              '[]'::jsonb
            )::text AS snapshot
       FROM advertisements a`,
  );
  return rows[0]!.snapshot;
};

const adCount = () => countRows(pool, `SELECT count(*)::text c FROM advertisements`, []);

const rollback = async (): Promise<void> => {
  await pool.query(ROLLBACK_SQL);
};

const applyMigration = async (): Promise<void> => {
  await scratch.exec(readMigration(ADVERTISEMENT_OWNERSHIP_MIGRATION));
};

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('adown');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  // Back to a fully migrated, empty database. Advertisements cascade from users;
  // the identities and their mapping cascade from the same place.
  await rollback();
  await pool.query(`DELETE FROM advertisements`);
  await pool.query(`DELETE FROM users WHERE email LIKE 'adown%@test.local'`);
  await applyMigration();
});

// ===========================================================================
// 1–4. Nothing, one, several, and several Businesses.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('the Business backfill', () => {
  it('assigns nothing when there are no advertisements', async () => {
    expect(await adCount()).toBe(0);
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM advertisements WHERE business_commercial_identity_id IS NOT NULL`,
        [],
      ),
    ).toBe(0);
  });

  it('re-associates one Business advertisement to that Business initial BCI', async () => {
    await rollback();
    const business = await seedUser('business');
    // The BCI spine mints the initial identity for an account that already exists.
    await scratch.exec(readMigration(BCI_MIGRATION));
    const adId = await seedAd(business);
    await applyMigration();

    const ownership = await ownershipOf(adId);
    expect(ownership.identity).toBe(deterministicInitialIdentityId(business));
    expect(ownership.kind).toBe('business');
    expect(ownership.state).toBe('commercial_identity_owned');
    expect(ownership.assignedAt).not.toBeNull();
  });

  it('re-associates every advertisement one Business owns, to the same identity', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const ads = [await seedAd(business), await seedAd(business), await seedAd(business)];
    await applyMigration();

    for (const adId of ads) {
      expect((await ownershipOf(adId)).identity).toBe(deterministicInitialIdentityId(business));
    }
  });

  it('keeps two Businesses isolated', async () => {
    await rollback();
    const first = await seedUser('business');
    const second = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const firstAd = await seedAd(first);
    const secondAd = await seedAd(second);
    await applyMigration();

    expect((await ownershipOf(firstAd)).identity).toBe(deterministicInitialIdentityId(first));
    expect((await ownershipOf(secondAd)).identity).toBe(deterministicInitialIdentityId(second));
    expect((await ownershipOf(firstAd)).identity).not.toBe((await ownershipOf(secondAd)).identity);
  });
});

// ===========================================================================
// 5–6. One owner, several identities, and no mixing between them.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('one owner controlling several identities', () => {
  it('maps a legacy advertisement only to the INITIAL identity', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const nativeId = await seedNativeIdentity(business);
    const adId = await seedAd(business);
    await applyMigration();

    const ownership = await ownershipOf(adId);
    expect(ownership.identity).toBe(deterministicInitialIdentityId(business));
    expect(ownership.identity).not.toBe(nativeId);
  });

  it('refuses to point an advertisement at a same-owner native identity', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const nativeId = await seedNativeIdentity(business);
    await applyMigration();

    // Created after the backfill, so it starts unassigned and the immutability
    // trigger is not what refuses this — the key is.
    const adId = await seedAd(business);

    // A native identity is not in the legacy map, so the composite foreign key
    // has nothing to reference. The database itself refuses.
    await expect(assign(adId, nativeId)).rejects.toMatchObject({ code: '23503' });
  });

  it("refuses to point an advertisement at another Business's identity", async () => {
    await rollback();
    const mine = await seedUser('business');
    const theirs = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await applyMigration();
    const adId = await seedAd(mine);

    // The other Business's identity IS mapped — but to the other Business. The
    // composite key names both columns, so a same-identity/different-advertiser
    // pair matches nothing.
    await expect(assign(adId, deterministicInitialIdentityId(theirs))).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('refuses an identity that does not exist at all', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await applyMigration();
    const adId = await seedAd(business);

    await expect(assign(adId, '00000000-0000-4000-8000-0000000000ff')).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('accepts the one assignment that is legal', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await applyMigration();
    const adId = await seedAd(business);

    await assign(adId, deterministicInitialIdentityId(business));

    expect((await ownershipOf(adId)).identity).toBe(deterministicInitialIdentityId(business));
  });
});

// ===========================================================================
// 7. Personal providers, untouched.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('personal provider compatibility', () => {
  it('leaves an Expert and a Craftsman campaign in the legacy state', async () => {
    await rollback();
    const expert = await seedUser('expert');
    const craftsman = await seedUser('craftsman');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const expertAd = await seedAd(expert);
    const craftsmanAd = await seedAd(craftsman);
    await applyMigration();

    for (const adId of [expertAd, craftsmanAd]) {
      const ownership = await ownershipOf(adId);
      expect(ownership.kind).toBeNull();
      expect(ownership.identity).toBeNull();
      expect(ownership.state).toBe('legacy_user_owned');
      expect(ownership.assignedAt).toBeNull();
    }
  });

  it('creates no identity for a personal provider', async () => {
    await rollback();
    const expert = await seedUser('expert');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await seedAd(expert);
    await applyMigration();

    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM business_commercial_identities WHERE owner_user_id = $1`,
        [expert],
      ),
    ).toBe(0);
  });

  it('migrates a Business without disturbing the personal providers beside it', async () => {
    await rollback();
    const business = await seedUser('business');
    const expert = await seedUser('expert');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const businessAd = await seedAd(business);
    const expertAd = await seedAd(expert);
    await applyMigration();

    expect((await ownershipOf(businessAd)).identity).toBe(deterministicInitialIdentityId(business));
    expect((await ownershipOf(expertAd)).identity).toBeNull();
  });
});

// ===========================================================================
// 8–9. Retry, and an assignment that is already correct.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('replay', () => {
  it('assigns nothing new on a second run', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const adId = await seedAd(business);
    await applyMigration();

    const before = await ownershipOf(adId);
    await applyMigration();
    const after = await ownershipOf(adId);

    // Including the timestamp: a second run that re-stamped `assigned_at` would
    // be rewriting a record it claims not to touch.
    expect(after).toEqual(before);
    expect(await adCount()).toBe(1);
  });

  it('preserves an assignment the request path already made', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await applyMigration();

    // A campaign created AFTER the migration, stamped by the API's own path —
    // the same UPDATE, through the same authoritative map.
    const adId = await seedAd(business);
    await pool.query(
      `UPDATE advertisements a
          SET commercial_owner_kind            = 'business',
              business_commercial_identity_id  = m.bci_id,
              commercial_ownership_state       = 'commercial_identity_owned',
              commercial_ownership_assigned_at = now()
         FROM business_commercial_identity_legacy_map m
        WHERE a.id = $1
          AND m.business_account_id = a.advertiser_id
          AND a.business_commercial_identity_id IS NULL`,
      [adId],
    );
    const stamped = await ownershipOf(adId);
    expect(stamped.identity).toBe(deterministicInitialIdentityId(business));

    // Re-running the migration must not re-stamp what is already correct.
    await applyMigration();
    expect(await ownershipOf(adId)).toEqual(stamped);
  });

  it('refuses to re-point or clear an assignment', async () => {
    await rollback();
    const business = await seedUser('business');
    const other = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const adId = await seedAd(business);
    await applyMigration();

    // Clearing would silently return the asset to legacy ownership.
    await expect(
      pool.query(`UPDATE advertisements SET business_commercial_identity_id = NULL WHERE id = $1`, [
        adId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });

    // Re-pointing is a reassociation operation, and Wave 3 defines none. The
    // trigger refuses before the key is even consulted.
    await expect(assign(adId, deterministicInitialIdentityId(other))).rejects.toMatchObject({
      code: '23514',
    });

    expect((await ownershipOf(adId)).identity).toBe(deterministicInitialIdentityId(business));
  });
});

// ===========================================================================
// 10–12. Contradictions the database will not hold.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('contradictory ownership is unrepresentable', () => {
  it('refuses a kind without an identity', async () => {
    await rollback();
    const expert = await seedUser('expert');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const adId = await seedAd(expert);
    await applyMigration();

    // A discriminator with nothing behind it is exactly the weak polymorphic
    // pair this model refuses to be.
    await expect(
      pool.query(`UPDATE advertisements SET commercial_owner_kind = 'business' WHERE id = $1`, [
        adId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an owner kind Wave 3 has not defined', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const adId = await seedAd(business);
    await applyMigration();

    await expect(
      pool.query(`UPDATE advertisements SET commercial_owner_kind = 'personal' WHERE id = $1`, [
        adId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a state that contradicts the ownership columns', async () => {
    await rollback();
    const expert = await seedUser('expert');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const adId = await seedAd(expert);
    await applyMigration();

    await expect(
      pool.query(
        `UPDATE advertisements SET commercial_ownership_state = 'commercial_identity_owned' WHERE id = $1`,
        [adId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an unknown ownership state', async () => {
    await rollback();
    const expert = await seedUser('expert');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const adId = await seedAd(expert);
    await applyMigration();

    await expect(
      pool.query(
        `UPDATE advertisements SET commercial_ownership_state = 'transferred' WHERE id = $1`,
        [adId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts an operator quarantine, and only on an unassigned row', async () => {
    await rollback();
    const expert = await seedUser('expert');
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const expertAd = await seedAd(expert);
    const businessAd = await seedAd(business);
    await applyMigration();

    await pool.query(
      `UPDATE advertisements SET commercial_ownership_state = 'quarantined_ambiguous' WHERE id = $1`,
      [expertAd],
    );
    expect((await ownershipOf(expertAd)).state).toBe('quarantined_ambiguous');

    await expect(
      pool.query(
        `UPDATE advertisements SET commercial_ownership_state = 'quarantined_ambiguous' WHERE id = $1`,
        [businessAd],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// ===========================================================================
// 13–17. What the migration must leave exactly as it found it.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('the historical record', () => {
  it('changes no advertisement id, and no count', async () => {
    await rollback();
    const business = await seedUser('business');
    const expert = await seedUser('expert');
    await scratch.exec(readMigration(BCI_MIGRATION));
    const ids = [await seedAd(business), await seedAd(business), await seedAd(expert)];

    const before = await pool.query<{ id: string }>(`SELECT id FROM advertisements ORDER BY id`);
    await applyMigration();
    const after = await pool.query<{ id: string }>(`SELECT id FROM advertisements ORDER BY id`);

    expect(after.rows.map((r) => r.id)).toEqual(before.rows.map((r) => r.id));
    expect(after.rows).toHaveLength(ids.length);
  });

  it('leaves every legacy column byte-identical', async () => {
    await rollback();
    const business = await seedUser('business');
    const expert = await seedUser('expert');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await seedAd(business, { status: 'active', billingStatus: 'active', amountPaid: '150.00' });
    await seedAd(business, { status: 'cancelled', billingStatus: 'cancelled' });
    await seedAd(expert, { status: 'expired', billingStatus: 'renewal_required' });

    const before = await legacySnapshot();
    await applyMigration();

    // Advertiser, status, billing model and status, amount paid, moderation
    // decision, renewal counters, timestamps — all of it, in one comparison.
    expect(await legacySnapshot()).toBe(before);
  });

  it('adds ownership columns to no other table', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('business_commercial_identity_id', 'commercial_owner_kind',
                              'commercial_ownership_state')
        GROUP BY table_name
        ORDER BY table_name`,
    );

    // Services, jobs, plans, subscriptions and wallets are later slices. This is
    // the assertion that catches a scope creep nobody meant to commit.
    expect(rows.map((r) => r.table_name)).toEqual(['advertisements']);
  });

  it("leaves the BCI spine's own rows untouched", async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await seedAd(business);

    const { rows: before } = await pool.query<{ snapshot: string }>(
      `SELECT (jsonb_agg(to_jsonb(b) ORDER BY b.id))::text AS snapshot
         FROM business_commercial_identities b`,
    );
    await applyMigration();
    const { rows: after } = await pool.query<{ snapshot: string }>(
      `SELECT (jsonb_agg(to_jsonb(b) ORDER BY b.id))::text AS snapshot
         FROM business_commercial_identities b`,
    );

    expect(after[0]!.snapshot).toBe(before[0]!.snapshot);
  });

  it('still lets a Business account be deleted', async () => {
    await rollback();
    const business = await seedUser('business');
    await scratch.exec(readMigration(BCI_MIGRATION));
    await seedAd(business);
    await applyMigration();

    // The advertisement, the mapping and the identity all cascade from `users`.
    // ON DELETE NO ACTION on the ownership key is what lets that resolve instead
    // of deadlocking on a RESTRICT that fires mid-cascade.
    await expect(pool.query(`DELETE FROM users WHERE id = $1`, [business])).resolves.toBeTruthy();
    expect(await adCount()).toBe(0);
  });
});
