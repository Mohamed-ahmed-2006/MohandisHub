// ---------------------------------------------------------------------------
// The BCI compatibility migration, against a REAL PostgreSQL.
// ---------------------------------------------------------------------------
// Every claim this slice makes is a claim about what the database refuses, and
// a mocked pool refuses nothing. These are the properties that need a server:
//
//   * the deterministic id really is a function of the account id, computed by
//     PostgreSQL and by Node to the same value;
//   * a second run of the backfill inserts nothing, because the primary key
//     collides rather than because a query looked first;
//   * concurrent mapping attempts settle on one row;
//   * a conflicting mapping is rejected by a constraint, not by a code path;
//   * ambiguous legacy data stops the migration before it writes anything;
//   * team IDs, memberships, roles, invitations and audit rows come out of the
//     migration byte-identical, and no asset ownership column moves.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

/** The migration under test, applied from its own file rather than a copy. */
const MIGRATION_FILE = '20260806090000_business_commercial_identity_compatibility.sql';

/**
 * The reversal documented in that migration's header.
 *
 * Prefixed with the one dependency a LATER migration created: 20260807090000
 * anchors advertisement ownership to the legacy map with a composite foreign
 * key, and the map cannot be dropped while that key names it. Releasing it here
 * keeps this suite's subject the BCI spine alone — the advertisement slice
 * proves its own reversal in `advertisement-ownership.migration.pg.test.ts`.
 */
const ROLLBACK_SQL = `
ALTER TABLE IF EXISTS public.advertisements
  DROP CONSTRAINT IF EXISTS fk_advertisements_business_identity_anchor;

DROP TRIGGER IF EXISTS trg_business_commercial_identities_immutable_owner
  ON public.business_commercial_identities;
DROP FUNCTION IF EXISTS public.business_commercial_identities_reject_owner_change();
DROP TABLE IF EXISTS public.business_commercial_identity_legacy_map;
DROP TABLE IF EXISTS public.business_commercial_identities;
DROP FUNCTION IF EXISTS public.business_commercial_identity_deterministic_id(UUID);
`;

let seq = 0;

const seedUser = async (role: string): Promise<string> => {
  seq += 1;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, primary_role, email_verified_at)
     VALUES ($1, 'x', $2, $3, now())
     RETURNING id`,
    [`bci${seq}-${Date.now().toString(36)}@test.local`, `User ${seq}`, role],
  );
  return rows[0]!.id;
};

/**
 * A Business account with a workspace, an owner membership, a role and a profile.
 *
 * The workspace, its role and its owner membership are created inside ONE
 * transaction. `trg_business_teams_owner_present` (20260731120000) is a
 * DEFERRABLE INITIALLY DEFERRED constraint trigger that asserts a committed
 * workspace has exactly one owner, so three autocommitted statements would
 * commit an ownerless workspace at the first one and be refused — correctly.
 * A real workspace is provisioned transactionally for the same reason.
 */
const seedBusinessWithWorkspace = async (): Promise<{
  businessId: string;
  teamId: string;
  memberId: string;
  roleId: string;
  profileId: string;
}> => {
  const businessId = await seedUser('business');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: profileRows } = await client.query<{ id: string }>(
      `INSERT INTO business_profiles (user_id, company_name) VALUES ($1, $2) RETURNING id`,
      [businessId, `Company ${seq}`],
    );

    const { rows: teamRows } = await client.query<{ id: string }>(
      `INSERT INTO business_teams (business_id, name) VALUES ($1, $2) RETURNING id`,
      [businessId, `Workspace ${seq}`],
    );
    const teamId = teamRows[0]!.id;

    const { rows: roleRows } = await client.query<{ id: string }>(
      `INSERT INTO business_team_roles (team_id, role_key, name, built_in, permissions)
       VALUES ($1, 'owner', 'Owner', true, '["manage_team"]'::jsonb)
       RETURNING id`,
      [teamId],
    );
    const roleId = roleRows[0]!.id;

    const { rows: memberRows } = await client.query<{ id: string }>(
      `INSERT INTO business_members (team_id, user_id, role, role_id)
       VALUES ($1, $2, 'owner', $3)
       RETURNING id`,
      [teamId, businessId, roleId],
    );

    await client.query('COMMIT');

    return {
      businessId,
      teamId,
      memberId: memberRows[0]!.id,
      roleId,
      profileId: profileRows[0]!.id,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/** Every table in the public schema, so the migration's footprint can be diffed. */
const publicTables = async (): Promise<string[]> => {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
};

/** A snapshot of everything the migration must not touch. */
const teamShapeSnapshot = async (): Promise<string> => {
  const { rows } = await pool.query<{ snapshot: string }>(
    `SELECT jsonb_build_object(
              'teams', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
                          FROM business_teams t),
              'members', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb)
                            FROM business_members m),
              'roles', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
                          FROM business_team_roles r),
              'invites', (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb)
                            FROM business_team_invites i),
              'profiles', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb)
                             FROM business_profiles p)
            )::text AS snapshot`,
  );
  return rows[0]!.snapshot;
};

const identityCount = () =>
  countRows(pool, `SELECT count(*)::text c FROM business_commercial_identities`, []);

const mappingCount = () =>
  countRows(pool, `SELECT count(*)::text c FROM business_commercial_identity_legacy_map`, []);

const mappedIdentityFor = async (businessId: string): Promise<string | null> => {
  const { rows } = await pool.query<{ bci_id: string }>(
    `SELECT bci_id FROM business_commercial_identity_legacy_map WHERE business_account_id = $1`,
    [businessId],
  );
  return rows[0]?.bci_id ?? null;
};

/** Take the scratch database back to the state just before this migration. */
const rollback = async (): Promise<void> => {
  await pool.query(ROLLBACK_SQL);
};

const applyMigration = async (): Promise<void> => {
  await scratch.exec(readMigration(MIGRATION_FILE));
};

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('bci');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  // Back to a fully migrated, empty database. Workspaces cascade; invitations
  // go first because their role foreign key is ON DELETE RESTRICT.
  await pool.query(ROLLBACK_SQL);
  await pool.query(`DELETE FROM business_team_audit_log`);
  await pool.query(`DELETE FROM business_team_invites`);
  await pool.query(`DELETE FROM business_teams`);
  await pool.query(`DELETE FROM business_profiles`);
  await pool.query(`DELETE FROM users WHERE email LIKE 'bci%@test.local'`);
  await applyMigration();
});

// ===========================================================================
// 1–3. Nothing, one, and several.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('deterministic backfill', () => {
  it('creates nothing when there are no legacy Businesses', async () => {
    expect(await identityCount()).toBe(0);
    expect(await mappingCount()).toBe(0);
  });

  it('creates exactly one BCI for one legacy Business', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();

    expect(await identityCount()).toBe(1);
    expect(await mappingCount()).toBe(1);
    expect(await mappedIdentityFor(business.businessId)).toBe(
      deterministicInitialIdentityId(business.businessId),
    );
  });

  it('gives several legacy Businesses isolated identities', async () => {
    await rollback();
    const first = await seedBusinessWithWorkspace();
    const second = await seedBusinessWithWorkspace();
    const third = await seedBusinessWithWorkspace();
    await applyMigration();

    const ids = await Promise.all(
      [first, second, third].map((b) => mappedIdentityFor(b.businessId)),
    );

    expect(await identityCount()).toBe(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(deterministicInitialIdentityId(first.businessId));
    expect(ids[1]).toBe(deterministicInitialIdentityId(second.businessId));
    expect(ids[2]).toBe(deterministicInitialIdentityId(third.businessId));
  });

  it('computes in PostgreSQL exactly what Node computes', async () => {
    // Fixed inputs, so this pins the rule rather than sampling it. The set
    // spans the variant nibble's whole range: the derivation keeps two bits of
    // the hash and forces two, and a mistake there shows up on some inputs and
    // not others.
    const accounts = [
      '00000000-0000-4000-8000-000000000000',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '7f3a1c9e-5b2d-4e8a-9c1f-0d6b4a2e8c37',
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
    ];

    const { rows } = await pool.query<{ input: string; id: string }>(
      `SELECT u AS input, public.business_commercial_identity_deterministic_id(u::uuid) AS id
         FROM unnest($1::text[]) AS u`,
      [accounts],
    );

    expect(rows).toHaveLength(accounts.length);
    for (const row of rows) {
      expect([row.input, row.id]).toEqual([row.input, deterministicInitialIdentityId(row.input)]);
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    // Distinct inputs, distinct identities.
    expect(new Set(rows.map((r) => r.id)).size).toBe(accounts.length);
  });

  it('creates no identity for a Business account that gains the role later, until re-run', async () => {
    await rollback();
    const account = await seedUser('customer');
    await applyMigration();
    expect(await mappedIdentityFor(account)).toBeNull();

    await pool.query(`UPDATE users SET primary_role = 'business' WHERE id = $1`, [account]);
    await applyMigration();

    expect(await mappedIdentityFor(account)).toBe(deterministicInitialIdentityId(account));
  });

  it('includes a deactivated Business account', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [business.businessId]);
    await applyMigration();

    expect(await mappedIdentityFor(business.businessId)).not.toBeNull();
  });

  it('creates no identity for an account that is not a Business', async () => {
    await rollback();
    await seedUser('customer');
    await seedUser('expert');
    await applyMigration();

    expect(await identityCount()).toBe(0);
  });
});

// ===========================================================================
// 4–6. Retry, concurrency, and an existing correct mapping.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('idempotency and concurrency', () => {
  it('creates no duplicate when the migration is applied again', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();
    const first = await mappedIdentityFor(business.businessId);

    // Re-running the backfill statements is the retry that matters: the DDL is
    // guarded by IF NOT EXISTS, and the inserts have to converge on their own.
    await applyMigration();

    expect(await identityCount()).toBe(1);
    expect(await mappingCount()).toBe(1);
    expect(await mappedIdentityFor(business.businessId)).toBe(first);
  });

  it('reuses an existing correct mapping rather than replacing it', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();

    const { rows: before } = await pool.query<{ created_at: Date }>(
      `SELECT created_at FROM business_commercial_identities WHERE owner_user_id = $1`,
      [business.businessId],
    );

    await applyMigration();

    const { rows: after } = await pool.query<{ created_at: Date }>(
      `SELECT created_at FROM business_commercial_identities WHERE owner_user_id = $1`,
      [business.businessId],
    );

    expect(after[0]!.created_at.toISOString()).toBe(before[0]!.created_at.toISOString());
  });

  it('settles concurrent mapping attempts on exactly one row', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();
    await pool.query(`DELETE FROM business_commercial_identity_legacy_map`);
    await pool.query(`DELETE FROM business_commercial_identities`);

    const attempt = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
           SELECT public.business_commercial_identity_deterministic_id(u.id), u.id, 'active', 'legacy_business_account'
             FROM users u WHERE u.primary_role = 'business'
           ON CONFLICT (id) DO NOTHING`,
        );
        await client.query(
          `INSERT INTO business_commercial_identity_legacy_map
             (business_account_id, bci_id, created_by_migration)
           SELECT u.id, public.business_commercial_identity_deterministic_id(u.id), true
             FROM users u WHERE u.primary_role = 'business'
           ON CONFLICT (business_account_id) DO NOTHING`,
        );
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => {});
      } finally {
        client.release();
      }
    };

    await Promise.all(Array.from({ length: 10 }, attempt));

    expect(await identityCount()).toBe(1);
    expect(await mappingCount()).toBe(1);
    expect(await mappedIdentityFor(business.businessId)).toBe(
      deterministicInitialIdentityId(business.businessId),
    );
  });
});

// ===========================================================================
// 7–10. Conflict, ambiguity, ownership.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('conflicting and ambiguous data fails closed', () => {
  it('rejects a mapping to an identity that is not the deterministic one', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    const other = await seedBusinessWithWorkspace();
    await applyMigration();

    await expect(
      pool.query(
        `UPDATE business_commercial_identity_legacy_map
            SET bci_id = $2 WHERE business_account_id = $1`,
        [business.businessId, deterministicInitialIdentityId(other.businessId)],
      ),
    ).rejects.toThrow();
  });

  it('rejects a second initial identity for one Business', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();

    await expect(
      pool.query(
        `INSERT INTO business_commercial_identity_legacy_map (business_account_id, bci_id)
         VALUES ($1, $2)`,
        [business.businessId, deterministicInitialIdentityId(business.businessId)],
      ),
    ).rejects.toThrow();
  });

  it('rejects one identity mapped to two Businesses', async () => {
    await rollback();
    const first = await seedBusinessWithWorkspace();
    const second = await seedBusinessWithWorkspace();
    await applyMigration();

    await expect(
      pool.query(
        `UPDATE business_commercial_identity_legacy_map
            SET business_account_id = $2 WHERE business_account_id = $1`,
        [first.businessId, second.businessId],
      ),
    ).rejects.toThrow();
  });

  it('rejects an identity whose owner disagrees with its mapping', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    const outsider = await seedUser('customer');
    await applyMigration();

    // Owner is immutable, and the composite key would refuse the move anyway.
    await expect(
      pool.query(`UPDATE business_commercial_identities SET owner_user_id = $2 WHERE id = $1`, [
        deterministicInitialIdentityId(business.businessId),
        outsider,
      ]),
    ).rejects.toThrow(/immutable/i);
  });

  it('rejects a legacy-origin identity whose id is not the deterministic one', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();

    await expect(
      pool.query(
        `INSERT INTO business_commercial_identities (id, owner_user_id, status, origin)
         VALUES ('99999999-9999-4999-8999-999999999999', $1, 'active', 'legacy_business_account')`,
        [business.businessId],
      ),
    ).rejects.toThrow();
  });

  it('aborts on a workspace owned by an account that is not a Business', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    // Reach past the protective trigger to reproduce the legacy state it was
    // added to prevent but never validated.
    await pool.query(`ALTER TABLE users DISABLE TRIGGER trg_users_protect_workspace_owner_role`);
    await pool.query(`UPDATE users SET primary_role = 'customer' WHERE id = $1`, [
      business.businessId,
    ]);
    await pool.query(`ALTER TABLE users ENABLE TRIGGER trg_users_protect_workspace_owner_role`);

    await expect(applyMigration()).rejects.toThrow(/Refusing to migrate/i);

    // Nothing was written, and the ambiguity was not resolved by guessing.
    const { rows } = await pool.query<{ present: boolean }>(
      `SELECT to_regclass('public.business_commercial_identities') IS NOT NULL AS present`,
    );
    expect(rows[0]!.present).toBe(false);
  });

  it('names the canonical Business account as the initial identity owner', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();

    const { rows } = await pool.query<{ owner_user_id: string; origin: string }>(
      `SELECT owner_user_id, origin FROM business_commercial_identities`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.owner_user_id).toBe(business.businessId);
    expect(rows[0]!.origin).toBe('legacy_business_account');
  });
});

// ===========================================================================
// 11–13. What must come out unchanged.
// ===========================================================================

describe.skipIf(!pgIntegrationEnabled())('the migration is additive', () => {
  it('leaves team IDs, members, roles, invitations and profiles byte-identical', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await pool.query(
      `INSERT INTO business_team_invites
         (team_id, email, role_id, token_hash, expires_at, invited_by, status, role_name_snapshot)
       VALUES ($1, $2, $3, repeat('a', 64), now() + interval '7 days', $4, 'pending', 'Owner')`,
      [business.teamId, `invitee-${seq}@test.local`, business.roleId, business.businessId],
    );
    // A role still carrying a reserved permission — B3 names this case
    // explicitly, because it is the one a tidying migration would "fix".
    await pool.query(
      `UPDATE business_team_roles
          SET permissions = '["manage_team","manage_jobs","view_analytics"]'::jsonb
        WHERE id = $1`,
      [business.roleId],
    );

    const before = await teamShapeSnapshot();
    await applyMigration();
    const after = await teamShapeSnapshot();

    expect(after).toBe(before);
  });

  it('preserves a reserved permission on the role that carries it', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await pool.query(
      `UPDATE business_team_roles SET permissions = '["manage_team","view_wallet"]'::jsonb
        WHERE id = $1`,
      [business.roleId],
    );
    await applyMigration();

    const { rows } = await pool.query<{ permissions: string[] }>(
      `SELECT permissions FROM business_team_roles WHERE id = $1`,
      [business.roleId],
    );
    expect(rows[0]!.permissions).toContain('view_wallet');
  });

  it('leaves every existing commercial asset ownership column untouched', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();

    const ownershipShape = async () => {
      const { rows } = await pool.query<{ shape: string }>(
        `SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'table', c.table_name, 'column', c.column_name, 'type', c.data_type,
                  'nullable', c.is_nullable)
                ORDER BY c.table_name, c.column_name), '[]'::jsonb)::text AS shape
           FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.column_name IN ('user_id', 'provider_id', 'business_id', 'owner_id')
            AND c.table_name NOT LIKE 'business_commercial_identit%'`,
      );
      return rows[0]!.shape;
    };

    const before = await ownershipShape();
    await applyMigration();

    expect(await ownershipShape()).toBe(before);
    // ...and no asset acquired a commercial-identity column.
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name IN ('bci_id', 'commercial_identity_id')
            AND table_name <> 'business_commercial_identity_legacy_map'`,
        [],
      ),
    ).toBe(0);
    expect(business.teamId).toBeTruthy();
  });

  it('creates no unrelated Wave 3 table', async () => {
    await rollback();
    const before = await publicTables();

    await applyMigration();
    const after = await publicTables();

    // The migration's entire table footprint, diffed rather than pattern-matched.
    // A name filter would both miss a table this slice must not create and trip
    // over pre-existing ones such as `reservation_location_proposals`.
    expect(after.filter((table) => !before.includes(table))).toEqual([
      'business_commercial_identities',
      'business_commercial_identity_legacy_map',
    ]);
    expect(before.filter((table) => !after.includes(table))).toEqual([]);
  });

  it('keeps the two new tables backend-only', async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('business_commercial_identities',
                          'business_commercial_identity_legacy_map')`,
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it('reverses completely, and re-applies to the identical identifiers', async () => {
    await rollback();
    const business = await seedBusinessWithWorkspace();
    await applyMigration();
    const before = await mappedIdentityFor(business.businessId);

    const teamShape = await teamShapeSnapshot();
    await rollback();
    expect(await teamShapeSnapshot()).toBe(teamShape);

    await applyMigration();
    expect(await mappedIdentityFor(business.businessId)).toBe(before);
  });
});
