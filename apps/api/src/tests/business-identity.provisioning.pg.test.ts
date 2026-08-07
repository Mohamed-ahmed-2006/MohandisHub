// ---------------------------------------------------------------------------
// Runtime initial-BCI provisioning, against a REAL PostgreSQL.
// ---------------------------------------------------------------------------
// The unit suite proves the decisions. These are the claims that need a server,
// because they are claims about transactions and about what the database
// refuses:
//
//   * a Business registration commits its account and its commercial identity
//     together — and when the identity cannot be written, NO account survives;
//   * concurrent provisioning of the same new Business settles on one identity
//     and one mapping, with every caller succeeding and none of them told a
//     duplicate happened;
//   * the identifier PostgreSQL would compute and the one Node computes are the
//     same value, so the runtime path and migration 104 converge;
//   * an admin role transition into Business provisions, and rolls the role
//     change back when the spine refuses;
//   * a Business registered today can immediately own an advertisement through
//     its commercial identity — the gap this slice exists to close;
//   * Customer, Expert and Craftsman registration create nothing.
//
// The repositories under test are the real ones, driven through a mocked
// `getPool` that returns the scratch pool. Nothing here models a database.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countRows,
  createScratchDatabase,
  pgIntegrationEnabled,
  type ScratchDatabase,
} from './support/pg-scratch.js';

/**
 * The scratch pool, handed to the application's own `getPool`.
 *
 * Hoisted so the module mock below can close over it before any repository is
 * imported; it is only dereferenced when a query actually runs, by which time
 * `beforeAll` has filled it in.
 */
const refs = vi.hoisted(() => ({ pool: null as Pool | null }));

vi.mock('../db/pool.js', () => ({
  getPool: () => refs.pool,
  hasDatabaseConfig: () => true,
}));

const { AuthRepository } = await import('../modules/auth/auth.repository.js');
const { AdminRepository } = await import('../modules/admin/admin.repository.js');
const { AdvertisementsRepository } =
  await import('../modules/advertisements/advertisements.repository.js');
const { resolveAdvertisementOwnership } =
  await import('../modules/advertisements/advertisement-ownership.repository.js');
const { deterministicInitialIdentityId } =
  await import('../modules/business-identity/business-identity.constants.js');
const { ensureInitialBusinessCommercialIdentity } =
  await import('../modules/business-identity/business-identity.provisioning.js');

let scratch: ScratchDatabase;
let pool: Pool;
let auth: InstanceType<typeof AuthRepository>;
let admin: InstanceType<typeof AdminRepository>;
let ads: InstanceType<typeof AdvertisementsRepository>;

let seq = 0;
const nextEmail = () => `prov${(seq += 1)}-${Date.now().toString(36)}@test.local`;

/** Register through the real registration transaction. */
const register = async (role: string, email = nextEmail()) => {
  const result = await auth.reclaimAndCreateUser({
    email,
    passwordHash: 'x',
    displayName: `User ${seq}`,
    role: role as 'business',
    dateOfBirth: '1990-01-01',
    companyName: 'Test Company',
  });
  if (!result.ok) throw new Error(`registration refused: ${result.reason}`);
  return result.user;
};

const identityCountFor = (ownerUserId: string) =>
  countRows(
    pool,
    `SELECT count(*)::text c FROM business_commercial_identities WHERE owner_user_id = $1`,
    [ownerUserId],
  );

const mappingCountFor = (businessAccountId: string) =>
  countRows(
    pool,
    `SELECT count(*)::text c FROM business_commercial_identity_legacy_map WHERE business_account_id = $1`,
    [businessAccountId],
  );

const identityOf = async (businessAccountId: string) => {
  const { rows } = await pool.query<{
    bci_id: string;
    owner_user_id: string;
    origin: string;
    status: string;
    created_by_migration: boolean;
    created_at: Date;
  }>(
    `SELECT m.bci_id, b.owner_user_id, b.origin, b.status, m.created_by_migration, b.created_at
       FROM business_commercial_identity_legacy_map m
       JOIN business_commercial_identities b ON b.id = m.bci_id
      WHERE m.business_account_id = $1`,
    [businessAccountId],
  );
  return rows[0] ?? null;
};

/** Create one campaign through the real advertisement write path. */
const createAd = async (advertiserId: string): Promise<string> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { randomUUID } = await import('node:crypto');
    const adId = randomUUID();
    await ads.createPendingAdInTx(
      client,
      advertiserId,
      {
        titleEn: 'Structural surveys',
        imageUrl: 'https://cdn.example/ad.png',
        linkType: 'profile',
      } as never,
      null,
      adId,
      null,
      { providerId: advertiserId, serviceId: null },
    );
    await ads.stampCommercialOwnerInTx(client, adId);
    await client.query('COMMIT');
    return adId;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('prov');
  pool = scratch.pool;
  refs.pool = pool;
  auth = new AuthRepository();
  admin = new AdminRepository();
  ads = new AdvertisementsRepository();
}, 1_800_000);

afterAll(async () => {
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  // Advertisements, identities and mappings all cascade from `users`.
  await pool.query(`DELETE FROM users WHERE email LIKE 'prov%@test.local'`);
});

// ===========================================================================
// Registration
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('Business registration', () => {
  it('commits the account and its commercial identity together', async () => {
    const user = await register('business');

    const identity = await identityOf(user.id);
    expect(identity).not.toBeNull();
    expect(identity!.bci_id).toBe(deterministicInitialIdentityId(user.id));
    expect(identity!.owner_user_id).toBe(user.id);
    expect(identity!.origin).toBe('legacy_business_account');
    expect(identity!.status).toBe('active');
  });

  it('creates exactly one identity and exactly one mapping', async () => {
    const user = await register('business');

    expect(await identityCountFor(user.id)).toBe(1);
    expect(await mappingCountFor(user.id)).toBe(1);
  });

  it('marks the row as written by the request path, not the migration', async () => {
    const user = await register('business');

    // Provenance stays distinguishable to an auditor: migration 104's rows say
    // true, everything provisioned since says false.
    expect((await identityOf(user.id))!.created_by_migration).toBe(false);
  });

  it('computes the identifier PostgreSQL computes', async () => {
    const user = await register('business');

    const { rows } = await pool.query<{ id: string }>(
      `SELECT public.business_commercial_identity_deterministic_id($1) AS id`,
      [user.id],
    );

    // Three implementations, one value: the migration's SQL function, the
    // TypeScript helper, and the row the runtime path actually wrote.
    expect(rows[0]!.id).toBe(deterministicInitialIdentityId(user.id));
    expect((await identityOf(user.id))!.bci_id).toBe(rows[0]!.id);
  });

  it('leaves no account behind when the identity cannot be written', async () => {
    const email = nextEmail();
    // Fault injection at the boundary the claim is about. Nothing else can make
    // the identity insert fail on a correct database, which is the point.
    await pool.query(`
      CREATE OR REPLACE FUNCTION pg_temp_refuse_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'identity refused by test'; END $$;
      CREATE TRIGGER trg_test_refuse_identity
        BEFORE INSERT ON public.business_commercial_identities
        FOR EACH ROW EXECUTE FUNCTION pg_temp_refuse_identity();
    `);
    try {
      await expect(register('business', email)).rejects.toThrow();

      // The registration transaction took the account with it. A Business row
      // with no commercial identity is the state this slice makes unreachable.
      expect(
        await countRows(pool, `SELECT count(*)::text c FROM users WHERE email = $1`, [email]),
      ).toBe(0);
      expect(
        await countRows(
          pool,
          `SELECT count(*)::text c FROM business_profiles bp
                                 JOIN users u ON u.id = bp.user_id WHERE u.email = $1`,
          [email],
        ),
      ).toBe(0);
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS trg_test_refuse_identity ON public.business_commercial_identities;
        DROP FUNCTION IF EXISTS pg_temp_refuse_identity();
      `);
    }
  });

  it('still registers a Business normally once the fault is gone', async () => {
    const user = await register('business');
    expect(await mappingCountFor(user.id)).toBe(1);
  });
});

// ===========================================================================
// Non-Business isolation
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('non-Business registration', () => {
  for (const role of ['customer', 'expert', 'craftsman'] as const) {
    it(`creates no commercial identity for a ${role}`, async () => {
      const user = await register(role);

      expect(await identityCountFor(user.id)).toBe(0);
      expect(await mappingCountFor(user.id)).toBe(0);
    });
  }

  it('creates none across a mixed cohort, and exactly one per Business', async () => {
    const business = await register('business');
    await register('expert');
    await register('craftsman');
    await register('customer');
    const second = await register('business');

    expect(
      await countRows(pool, `SELECT count(*)::text c FROM business_commercial_identities`, []),
    ).toBe(2);
    expect(await mappingCountFor(business.id)).toBe(1);
    expect(await mappingCountFor(second.id)).toBe(1);
  });

  it('refuses to provision a non-Business account directly', async () => {
    const expert = await register('expert');

    await expect(ensureInitialBusinessCommercialIdentity(pool, expert.id)).rejects.toMatchObject({
      code: 'BCI_PROVISIONING_FAILED',
      details: { reason: 'not_a_business_account' },
    });
    expect(await identityCountFor(expert.id)).toBe(0);
  });
});

// ===========================================================================
// Idempotency and concurrency
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('repeated and concurrent provisioning', () => {
  it('is inert on a Business that already has its identity', async () => {
    const user = await register('business');
    const before = await identityOf(user.id);

    const result = await ensureInitialBusinessCommercialIdentity(pool, user.id);

    expect(result.outcome).toBe('reused');
    expect(result.identityId).toBe(before!.bci_id);
    // created_at is the assertion that a re-run wrote nothing at all.
    expect((await identityOf(user.id))!.created_at).toEqual(before!.created_at);
    expect(await identityCountFor(user.id)).toBe(1);
  });

  it('settles ten concurrent attempts on one identity, with every attempt succeeding', async () => {
    // The account exists without an identity — the exact position a Business
    // created between migration 104 and this slice is in.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name, primary_role, date_of_birth)
       VALUES ($1, 'x', 'Racer', 'business', '1990-01-01') RETURNING id`,
      [nextEmail()],
    );
    const businessId = rows[0]!.id;

    const attempt = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await ensureInitialBusinessCommercialIdentity(client, businessId);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    };

    const settled = await Promise.allSettled(Array.from({ length: 10 }, attempt));

    // Per-attempt outcomes, asserted rather than swallowed: a signup that
    // succeeded must never be told a duplicate happened.
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(rejected.map((r) => String(r.reason))).toEqual([]);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    expect(fulfilled).toHaveLength(10);

    expect(new Set(fulfilled.map((s) => s.value.identityId))).toEqual(
      new Set([deterministicInitialIdentityId(businessId)]),
    );

    // Exactly one winner wrote, and everybody else read the winner's row.
    const outcomes = fulfilled.map((s) => s.value.outcome);
    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
    expect(await identityCountFor(businessId)).toBe(1);
    expect(await mappingCountFor(businessId)).toBe(1);
  }, 120_000);

  it('settles concurrent Business registrations on separate identities', async () => {
    const emails = [nextEmail(), nextEmail(), nextEmail(), nextEmail()];
    const settled = await Promise.allSettled(emails.map((e) => register('business', e)));

    expect(settled.filter((s) => s.status === 'rejected')).toEqual([]);
    for (const s of settled) {
      const user = (s as PromiseFulfilledResult<{ id: string }>).value;
      expect(await mappingCountFor(user.id)).toBe(1);
      expect((await identityOf(user.id))!.bci_id).toBe(deterministicInitialIdentityId(user.id));
    }
  }, 120_000);
});

// ===========================================================================
// Corrupt spine
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('a contradictory spine', () => {
  it('refuses when the deterministic identifier belongs to another Business', async () => {
    const mine = await register('business');
    const other = await register('business');

    // Free the identifier, then hand it to the wrong owner. Only reachable by
    // direct SQL, which is why it is worth proving the runtime path refuses it.
    await pool.query(
      `DELETE FROM business_commercial_identity_legacy_map WHERE business_account_id = $1`,
      [mine.id],
    );
    await pool.query(`DELETE FROM business_commercial_identities WHERE id = $1`, [
      deterministicInitialIdentityId(mine.id),
    ]);
    await pool.query(
      `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
       VALUES ($1, $2, 'active', 'native')`,
      [deterministicInitialIdentityId(mine.id), other.id],
    );

    await expect(ensureInitialBusinessCommercialIdentity(pool, mine.id)).rejects.toMatchObject({
      code: 'BCI_PROVISIONING_FAILED',
      details: { reason: 'owner_mismatch' },
    });

    // And it did not route around the corruption by minting a second identity.
    expect(await identityCountFor(mine.id)).toBe(0);
    expect(await mappingCountFor(mine.id)).toBe(0);
  });

  it('refuses when an identity at the deterministic identifier declares native origin', async () => {
    const user = await register('business');
    await pool.query(
      `DELETE FROM business_commercial_identity_legacy_map WHERE business_account_id = $1`,
      [user.id],
    );
    await pool.query(`UPDATE business_commercial_identities SET origin = 'native' WHERE id = $1`, [
      deterministicInitialIdentityId(user.id),
    ]);

    await expect(ensureInitialBusinessCommercialIdentity(pool, user.id)).rejects.toMatchObject({
      details: { reason: 'origin_conflict' },
    });
    expect(await mappingCountFor(user.id)).toBe(0);
  });

  it('completes a mapping the database is missing, without minting anything', async () => {
    const user = await register('business');
    await pool.query(
      `DELETE FROM business_commercial_identity_legacy_map WHERE business_account_id = $1`,
      [user.id],
    );

    const result = await ensureInitialBusinessCommercialIdentity(pool, user.id);

    expect(result.outcome).toBe('mapping_completed');
    expect(result.identityId).toBe(deterministicInitialIdentityId(user.id));
    expect(await identityCountFor(user.id)).toBe(1);
    expect(await mappingCountFor(user.id)).toBe(1);
  });

  it('cannot be talked into a second identity for one Business', async () => {
    const user = await register('business');

    // A native second identity is legitimate and does not disturb the anchor.
    await pool.query(
      `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
       VALUES (gen_random_uuid(), $1, 'active', 'native')`,
      [user.id],
    );
    await ensureInitialBusinessCommercialIdentity(pool, user.id);

    expect(await mappingCountFor(user.id)).toBe(1);
    expect((await identityOf(user.id))!.bci_id).toBe(deterministicInitialIdentityId(user.id));
  });
});

// ===========================================================================
// Role transition
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('the admin role transition', () => {
  it('provisions when an account becomes a Business', async () => {
    const user = await register('customer');
    expect(await identityCountFor(user.id)).toBe(0);

    await admin.changeUserRole(user.id, 'business');

    expect(await mappingCountFor(user.id)).toBe(1);
    expect((await identityOf(user.id))!.bci_id).toBe(deterministicInitialIdentityId(user.id));
  });

  it('rolls the role change back when the spine refuses', async () => {
    const user = await register('customer');
    const other = await register('business');
    // Occupy this account's deterministic identifier with somebody else's.
    await pool.query(
      `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
       VALUES ($1, $2, 'active', 'native')`,
      [deterministicInitialIdentityId(user.id), other.id],
    );

    await expect(admin.changeUserRole(user.id, 'business')).rejects.toMatchObject({
      code: 'BCI_PROVISIONING_FAILED',
      details: { reason: 'owner_mismatch' },
    });

    // The role change was part of the same transaction, so it is gone too. An
    // account is never left claiming to be a Business without an identity.
    const { rows } = await pool.query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1`,
      [user.id],
    );
    expect(rows[0]!.primary_role).toBe('customer');
    expect(await mappingCountFor(user.id)).toBe(0);
  });

  it('keeps the identity when a Business is switched to another role, and reuses it on return', async () => {
    const user = await register('business');
    const original = await identityOf(user.id);

    await admin.changeUserRole(user.id, 'expert');
    // Identities are not deleted: assets already associated with this one must
    // stay associated, and ownership is not transferable self-serve.
    expect(await mappingCountFor(user.id)).toBe(1);

    await admin.changeUserRole(user.id, 'business');

    expect(await mappingCountFor(user.id)).toBe(1);
    expect((await identityOf(user.id))!.created_at).toEqual(original!.created_at);
  });

  it('creates no identity when an account becomes a non-Business role', async () => {
    const user = await register('customer');

    await admin.changeUserRole(user.id, 'expert');
    await admin.changeUserRole(user.id, 'craftsman');

    expect(await identityCountFor(user.id)).toBe(0);
  });
});

// ===========================================================================
// The gap this slice exists to close
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())(
  'advertisement ownership for a Business registered today',
  () => {
    it('resolves to the Business initial identity, with no migration re-run', async () => {
      const user = await register('business');
      const adId = await createAd(user.id);

      const resolution = await resolveAdvertisementOwnership(pool, adId);

      expect(resolution).toMatchObject({
        kind: 'commercial_identity',
        owner: {
          legacyAdvertiserId: user.id,
          ownerKind: 'business',
          identityId: deterministicInitialIdentityId(user.id),
          identityOwnerUserId: user.id,
          // Stamped at creation, not fallen back to. Before this slice the same
          // registration produced `legacy_user` / `no_business_commercial_identity`.
          source: 'assigned',
          ownershipState: 'commercial_identity_owned',
        },
      });
    });

    it('records the ownership state on the row itself', async () => {
      const user = await register('business');
      const adId = await createAd(user.id);

      const { rows } = await pool.query<{
        commercial_owner_kind: string | null;
        business_commercial_identity_id: string | null;
        commercial_ownership_state: string;
      }>(
        `SELECT commercial_owner_kind, business_commercial_identity_id, commercial_ownership_state
         FROM advertisements WHERE id = $1`,
        [adId],
      );
      expect(rows[0]).toEqual({
        commercial_owner_kind: 'business',
        business_commercial_identity_id: deterministicInitialIdentityId(user.id),
        commercial_ownership_state: 'commercial_identity_owned',
      });
    });

    it('is unaffected by a second native identity the same owner creates later', async () => {
      const user = await register('business');
      const adId = await createAd(user.id);

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
       VALUES (gen_random_uuid(), $1, 'active', 'native') RETURNING id`,
        [user.id],
      );
      const nativeId = rows[0]!.id;

      const later = await createAd(user.id);

      for (const id of [adId, later]) {
        expect(await resolveAdvertisementOwnership(pool, id)).toMatchObject({
          owner: { identityId: deterministicInitialIdentityId(user.id) },
        });
      }
      // Wave 3 defines no reassociation, and none happened.
      expect(
        await countRows(
          pool,
          `SELECT count(*)::text c FROM advertisements WHERE business_commercial_identity_id = $1`,
          [nativeId],
        ),
      ).toBe(0);
    });

    it('leaves an Expert campaign in legacy compatibility, as the PCI slice expects', async () => {
      const expert = await register('expert');
      const adId = await createAd(expert.id);

      expect(await resolveAdvertisementOwnership(pool, adId)).toMatchObject({
        kind: 'legacy_user',
        owner: { legacyAdvertiserId: expert.id, reason: 'awaiting_personal_commercial_identity' },
      });
    });
  },
);
