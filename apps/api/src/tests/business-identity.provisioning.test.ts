// ---------------------------------------------------------------------------
// Runtime initial-BCI provisioning.
// ---------------------------------------------------------------------------
// Migration 20260806090000 gave every Business that existed at the time its
// initial commercial identity. A Business created afterwards got nothing, and
// stayed in legacy compatibility mode. This slice closes that at runtime, and
// the claims it makes are:
//
//   * a Business acquires exactly one deterministic identity and exactly one
//     authoritative mapping, owned by itself, of legacy origin;
//   * the identifier is the one migration 104 would have produced, because it is
//     computed by the same function and not by a second one;
//   * running it again changes nothing at all, including `created_at`;
//   * a contradiction is reported under its own name and never repaired by
//     minting a second identity;
//   * it never opens a transaction of its own, so a Business and its identity
//     commit together.
//
// Atomicity, concurrency and the end-to-end registration path need a real
// server and live in `business-identity.provisioning.pg.test.ts`.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { deterministicInitialIdentityId } from '../modules/business-identity/business-identity.constants.js';
import { ensureInitialBusinessCommercialIdentity } from '../modules/business-identity/business-identity.provisioning.js';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Assert on code, not on the comment above it. */
const codeOf = (relative: string): string =>
  readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');

const businessA = '11111111-1111-4111-8111-111111111111';
const businessB = '22222222-2222-4222-8222-222222222222';
const customer = '33333333-3333-4333-8333-333333333333';
const expert = '44444444-4444-4444-8444-444444444444';
const craftsman = '55555555-5555-4555-8555-555555555555';
const unknownAccount = '66666666-6666-4666-8666-666666666666';

/** A second identity the same owner created afterwards. Never a legacy anchor. */
const nativeIdentity = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const MINTED_AT = new Date('2026-08-07T09:00:00.000Z');

// ---------------------------------------------------------------------------
// A mutable model of the two spine tables, with the insert semantics the real
// statements use — ON CONFLICT DO NOTHING against a primary key.
// ---------------------------------------------------------------------------
// It enforces NO constraint beyond those keys. The database forbids almost every
// corrupt state exercised below; a function that only behaves while its
// constraints are intact behaves wrongly the one time they are not.

type UserSeed = { id: string; primary_role: string };
type IdentitySeed = { id: string; owner_user_id: string; origin?: string; created_at?: Date };
type MapSeed = { business_account_id: string; bci_id: string };

type FakeDb = Pool & {
  identities: IdentitySeed[];
  maps: MapSeed[];
  statements: string[];
};

const fakeDb = (seed: {
  users?: UserSeed[];
  identities?: IdentitySeed[];
  maps?: MapSeed[];
  /** Simulates a concurrent writer committing between the read and the insert. */
  onIdentityInsert?: (db: { identities: IdentitySeed[]; maps: MapSeed[] }) => void;
}): FakeDb => {
  const users = seed.users ?? [];
  const identities = [...(seed.identities ?? [])];
  const maps = [...(seed.maps ?? [])];
  const statements: string[] = [];

  const db = {
    identities,
    maps,
    statements,
    query: (sql: string, values: unknown[] = []) => {
      statements.push(sql.trim());

      if (sql.includes('SELECT primary_role FROM users')) {
        return Promise.resolve({ rows: users.filter((u) => u.id === values[0]) });
      }

      if (sql.includes('INSERT INTO business_commercial_identities')) {
        seed.onIdentityInsert?.({ identities, maps });
        if (!identities.some((i) => i.id === values[0])) {
          identities.push({
            id: values[0] as string,
            owner_user_id: values[1] as string,
            origin: 'legacy_business_account',
            created_at: MINTED_AT,
          });
        }
        return Promise.resolve({ rows: [] });
      }

      if (sql.includes('INSERT INTO business_commercial_identity_legacy_map')) {
        if (!maps.some((m) => m.business_account_id === values[0])) {
          maps.push({ business_account_id: values[0] as string, bci_id: values[1] as string });
        }
        return Promise.resolve({ rows: [] });
      }

      // The spine read: the identity at the deterministic id, plus the mapping
      // for the account, plus how many mappings that account has.
      const identity = identities.find((i) => i.id === values[0]) ?? null;
      const accountMaps = maps.filter((m) => m.business_account_id === values[1]);
      return Promise.resolve({
        rows: [
          {
            identity_id: identity?.id ?? null,
            identity_owner: identity?.owner_user_id ?? null,
            identity_origin: identity ? (identity.origin ?? 'legacy_business_account') : null,
            identity_created_at: identity ? (identity.created_at ?? MINTED_AT) : null,
            mapped_identity_id: accountMaps[0]?.bci_id ?? null,
            mapping_count: String(accountMaps.length),
          },
        ],
      });
    },
    // `pg` types `query` as an overload set this fixture has no reason to
    // reproduce; the module only ever calls the (sql, values) form.
  } as unknown as FakeDb;

  return db;
};

/** The state a fully provisioned Business is in. */
const provisioned = (accountId: string) => ({
  users: [{ id: accountId, primary_role: 'business' }],
  identities: [{ id: deterministicInitialIdentityId(accountId), owner_user_id: accountId }],
  maps: [{ business_account_id: accountId, bci_id: deterministicInitialIdentityId(accountId) }],
});

const insertsIn = (db: FakeDb): string[] => db.statements.filter((s) => s.startsWith('INSERT'));

// ===========================================================================
// A new Business is fully provisioned
// ===========================================================================

describe('a new Business account', () => {
  const freshDb = () => fakeDb({ users: [{ id: businessA, primary_role: 'business' }] });

  it('receives exactly one commercial identity and exactly one mapping', async () => {
    const db = freshDb();

    const result = await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(result.outcome).toBe('created');
    expect(db.identities).toHaveLength(1);
    expect(db.maps).toHaveLength(1);
  });

  it('names the Business account itself as the owner', async () => {
    const db = freshDb();

    const result = await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(result.ownerUserId).toBe(businessA);
    expect(db.identities[0]!.owner_user_id).toBe(businessA);
  });

  it('declares legacy origin, so it is recognisable as an initial identity', async () => {
    const db = freshDb();

    await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(db.identities[0]!.origin).toBe('legacy_business_account');
  });

  it('uses the identifier migration 104 would have produced', async () => {
    const db = freshDb();

    const result = await ensureInitialBusinessCommercialIdentity(db, businessA);

    // Not "a UUID" — THE identifier. If the runtime path and the migration ever
    // disagreed, one Business would have two initial identities depending on
    // which ran first, which is the failure the whole spine exists to prevent.
    expect(result.identityId).toBe(deterministicInitialIdentityId(businessA));
    expect(db.maps[0]!.bci_id).toBe(deterministicInitialIdentityId(businessA));
  });

  it('anchors the mapping to the same account and identity', async () => {
    const db = freshDb();

    await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(db.maps[0]).toEqual({
      business_account_id: businessA,
      bci_id: deterministicInitialIdentityId(businessA),
    });
  });

  it('gives two Businesses different identities', async () => {
    const db = fakeDb({
      users: [
        { id: businessA, primary_role: 'business' },
        { id: businessB, primary_role: 'business' },
      ],
    });

    const a = await ensureInitialBusinessCommercialIdentity(db, businessA);
    const b = await ensureInitialBusinessCommercialIdentity(db, businessB);

    expect(a.identityId).not.toBe(b.identityId);
    expect(db.identities).toHaveLength(2);
    expect(db.maps).toHaveLength(2);
  });
});

// ===========================================================================
// Idempotency
// ===========================================================================

describe('running it again', () => {
  it('returns the same identity and creates nothing', async () => {
    const db = fakeDb({ users: [{ id: businessA, primary_role: 'business' }] });

    const first = await ensureInitialBusinessCommercialIdentity(db, businessA);
    const second = await ensureInitialBusinessCommercialIdentity(db, businessA);
    const third = await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(second.identityId).toBe(first.identityId);
    expect(third.identityId).toBe(first.identityId);
    expect(second.outcome).toBe('reused');
    expect(third.outcome).toBe('reused');
    expect(db.identities).toHaveLength(1);
    expect(db.maps).toHaveLength(1);
  });

  it('does not move created_at', async () => {
    const db = fakeDb(provisioned(businessA));
    db.identities[0]!.created_at = new Date('2026-01-01T00:00:00.000Z');

    const result = await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('issues no write at all when both rows are already correct', async () => {
    const db = fakeDb(provisioned(businessA));

    await ensureInitialBusinessCommercialIdentity(db, businessA);

    // The read-first shape matters on a path that runs on every Business
    // registration: a correct spine costs two SELECTs and nothing else.
    expect(insertsIn(db)).toEqual([]);
  });

  it('completes a mapping when the identity exists without one', async () => {
    // Reachable only from a partially applied repair. Safe to complete because
    // nothing is chosen: the mapping is a pure function of the account, and the
    // identity has already been proved to belong to it and to declare legacy
    // origin.
    const db = fakeDb({
      users: [{ id: businessA, primary_role: 'business' }],
      identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
    });

    const result = await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(result.outcome).toBe('mapping_completed');
    expect(result.identityId).toBe(deterministicInitialIdentityId(businessA));
    expect(db.identities).toHaveLength(1);
    expect(db.maps).toHaveLength(1);
    // It completed the anchor; it did not mint a second identity to carry it.
    expect(insertsIn(db)).toHaveLength(1);
  });

  it('converges when another transaction wins the race between the read and the insert', async () => {
    // The loser's INSERT waits on the primary key, does nothing, and the read
    // back sees the winner's row. Both callers return the same identity, and
    // neither surfaces a duplicate to a signup that succeeded.
    const db = fakeDb({
      users: [{ id: businessA, primary_role: 'business' }],
      onIdentityInsert: ({ identities, maps }) => {
        identities.push({
          id: deterministicInitialIdentityId(businessA),
          owner_user_id: businessA,
          origin: 'legacy_business_account',
          created_at: new Date('2026-02-02T00:00:00.000Z'),
        });
        maps.push({
          business_account_id: businessA,
          bci_id: deterministicInitialIdentityId(businessA),
        });
      },
    });

    const result = await ensureInitialBusinessCommercialIdentity(db, businessA);

    expect(result.identityId).toBe(deterministicInitialIdentityId(businessA));
    expect(result.createdAt).toBe('2026-02-02T00:00:00.000Z');
    expect(db.identities).toHaveLength(1);
    expect(db.maps).toHaveLength(1);
  });
});

// ===========================================================================
// Contradictions fail closed
// ===========================================================================

describe('a contradictory spine', () => {
  const cases: Array<[string, Parameters<typeof fakeDb>[0], string]> = [
    [
      'the deterministic identity belongs to another Business',
      {
        users: [{ id: businessA, primary_role: 'business' }],
        identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessB }],
      },
      'owner_mismatch',
    ],
    [
      'the deterministic identity declares native origin',
      {
        users: [{ id: businessA, primary_role: 'business' }],
        identities: [
          {
            id: deterministicInitialIdentityId(businessA),
            owner_user_id: businessA,
            origin: 'native',
          },
        ],
      },
      'origin_conflict',
    ],
    [
      'the account is anchored to an identity that is not its deterministic one',
      {
        users: [{ id: businessA, primary_role: 'business' }],
        identities: [
          { id: deterministicInitialIdentityId(businessA), owner_user_id: businessA },
          { id: nativeIdentity, owner_user_id: businessA, origin: 'native' },
        ],
        maps: [{ business_account_id: businessA, bci_id: nativeIdentity }],
      },
      'non_deterministic_mapping',
    ],
    [
      'the mapping names an identity that does not exist',
      {
        users: [{ id: businessA, primary_role: 'business' }],
        maps: [
          {
            business_account_id: businessA,
            bci_id: deterministicInitialIdentityId(businessA),
          },
        ],
      },
      'mapping_identity_missing',
    ],
    [
      'the account carries more than one mapping',
      {
        users: [{ id: businessA, primary_role: 'business' }],
        identities: [
          { id: deterministicInitialIdentityId(businessA), owner_user_id: businessA },
          { id: nativeIdentity, owner_user_id: businessA },
        ],
        maps: [
          {
            business_account_id: businessA,
            bci_id: deterministicInitialIdentityId(businessA),
          },
          { business_account_id: businessA, bci_id: nativeIdentity },
        ],
      },
      'duplicate_legacy_mappings',
    ],
  ];

  for (const [label, seed, reason] of cases) {
    it(`refuses when ${label}`, async () => {
      const db = fakeDb(seed);
      const before = db.identities.length;

      await expect(ensureInitialBusinessCommercialIdentity(db, businessA)).rejects.toMatchObject({
        statusCode: 409,
        code: 'BCI_PROVISIONING_FAILED',
        details: { reason, businessAccountId: businessA },
      });

      // The refusal that matters most: corruption is never routed around by
      // minting a second identity. One Business acquiring two is the failure
      // this whole compatibility spine is built to prevent.
      expect(insertsIn(db)).toEqual([]);
      expect(db.identities).toHaveLength(before);
    });
  }
});

// ===========================================================================
// The Business-only path is Business-only
// ===========================================================================

describe('a non-Business account', () => {
  for (const [role, id] of [
    ['customer', customer],
    ['expert', expert],
    ['craftsman', craftsman],
  ] as const) {
    it(`cannot be provisioned through the Business path (${role})`, async () => {
      const db = fakeDb({ users: [{ id, primary_role: role }] });

      await expect(ensureInitialBusinessCommercialIdentity(db, id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'BCI_PROVISIONING_FAILED',
        details: { reason: 'not_a_business_account' },
      });
      expect(db.identities).toEqual([]);
      expect(db.maps).toEqual([]);
    });
  }

  it('refuses an account that does not exist', async () => {
    const db = fakeDb({ users: [] });

    await expect(ensureInitialBusinessCommercialIdentity(db, unknownAccount)).rejects.toMatchObject(
      { details: { reason: 'not_a_business_account' } },
    );
    expect(insertsIn(db)).toEqual([]);
  });
});

// ===========================================================================
// How it is built, and where it is wired
// ===========================================================================

describe('the provisioning primitive', () => {
  const source = () => codeOf('../modules/business-identity/business-identity.provisioning.ts');

  it('reuses the BCI foundation identifier rule instead of restating it', () => {
    const code = source();

    expect(code).toContain(
      "import { deterministicInitialIdentityId } from './business-identity.constants.js'",
    );
    // No second generator: no hash, no namespace string, no UUID literal
    // construction. A second implementation would be a second answer to which
    // identity is a Business's initial one.
    expect(code).not.toMatch(/createHash|md5|sha1|randomUUID|gen_random_uuid|uuid_generate/i);
    expect(code).not.toContain('mohandishub:wave3:');
  });

  it('never opens a transaction of its own', () => {
    const code = source();

    // It runs on the caller's client so a Business and its identity commit
    // together. Its own BEGIN would put the identity in a separate transaction
    // that could commit while the Business rolled back, or vice versa.
    expect(code).not.toMatch(/'BEGIN'|"BEGIN"|'COMMIT'|"COMMIT"|'ROLLBACK'|"ROLLBACK"/);
    expect(code).not.toContain('getPool');
    expect(code).not.toContain('.connect(');
  });

  it('converges on primary keys rather than on a lock or a retry loop', () => {
    const code = source();

    expect(code).toContain('ON CONFLICT (id) DO NOTHING');
    expect(code).toContain('ON CONFLICT (business_account_id) DO NOTHING');
    expect(code).not.toMatch(/pg_advisory|FOR UPDATE|while\s*\(|retry/i);
  });

  it('records that a runtime row was not written by the migration', () => {
    expect(source()).toContain('created_by_migration');
    expect(source()).toContain('VALUES ($1, $2, false)');
  });

  it('consults no membership, permission or workspace state', () => {
    const code = source();

    for (const forbidden of [
      'business_members',
      'business_team_roles',
      'business_teams',
      'manage_team',
      'hasPermission',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('is wired into registration, inside the registration transaction', () => {
    const code = codeOf('../modules/auth/auth.repository.ts');

    expect(code).toContain('ensureInitialBusinessCommercialIdentity(client, created.id)');
    // On the caller's client, and before the COMMIT — the two properties that
    // make a registered Business without an identity unreachable.
    const call = code.indexOf('ensureInitialBusinessCommercialIdentity(client');
    const commit = code.indexOf("await client.query('COMMIT')", call);
    expect(call).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(call);
  });

  it('is wired into the admin role transition, inside its transaction', () => {
    const code = codeOf('../modules/admin/admin.repository.ts');

    expect(code).toContain('ensureInitialBusinessCommercialIdentity(client, userId)');
    const call = code.indexOf('ensureInitialBusinessCommercialIdentity(client');
    const commit = code.indexOf("await client.query('COMMIT')", call);
    expect(call).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(call);
  });

  it('is reached only from the Business branch of each path', () => {
    // The isolation guarantee for Customer, Expert and Craftsman registration is
    // not a check inside the primitive — it is that the primitive is not called.
    for (const relative of [
      '../modules/auth/auth.repository.ts',
      '../modules/admin/admin.repository.ts',
    ]) {
      const code = codeOf(relative);
      const call = code.indexOf('ensureInitialBusinessCommercialIdentity(client');
      const businessCase = code.lastIndexOf("case 'business':", call);
      const previousBreak = code.lastIndexOf('break;', call);

      expect(businessCase).toBeGreaterThan(-1);
      // Nothing closes the `case 'business'` block between its label and the
      // call, so the call belongs to that branch and to no other.
      expect(previousBreak).toBeLessThan(businessCase);
    }
  });

  it('is called exactly once per path', () => {
    for (const relative of [
      '../modules/auth/auth.repository.ts',
      '../modules/admin/admin.repository.ts',
    ]) {
      const calls = codeOf(relative).match(/ensureInitialBusinessCommercialIdentity\(/g) ?? [];
      expect(calls).toHaveLength(1);
    }
  });

  it('adds no migration — the spine schema already holds everything it writes', () => {
    const migrations = readSource(
      '../../../../supabase/migrations/20260806090000_business_commercial_identity_compatibility.sql',
    );

    // Both tables, both keys and the deterministic CHECK already exist. Runtime
    // provisioning is logic, not schema.
    expect(migrations).toContain(
      'CREATE TABLE IF NOT EXISTS public.business_commercial_identities',
    );
    expect(migrations).toContain(
      'CREATE TABLE IF NOT EXISTS public.business_commercial_identity_legacy_map',
    );
    expect(migrations).toContain('created_by_migration BOOLEAN NOT NULL DEFAULT false');
  });
});
