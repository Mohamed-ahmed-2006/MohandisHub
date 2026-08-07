// ---------------------------------------------------------------------------
// Advertisement ownership on the Commercial Identity spine.
// ---------------------------------------------------------------------------
// The slice makes four claims:
//
//   1. Business advertisements are re-associated to the OWNING commercial
//      identity — the advertiser's authoritative initial BCI, and no other.
//   2. Personal provider advertisements are untouched and keep working, because
//      the identity that will own them does not exist yet.
//   3. Reading ownership prefers the canonical owner, falls back to the legacy
//      compatibility rule only when there is no canonical owner to fail, and
//      fails CLOSED when the two contradict.
//   4. Commercial authority over a Business advertisement belongs to the
//      identity's canonical controller and to nobody else — not a team member,
//      not `manage_team`, not an Admin-labelled role, not a reserved permission,
//      not a selected workspace, and not the same owner acting through a second
//      identity they happen to control.
//
// Claims 1 and 2 are properties of a migration, so they are asserted here
// against the migration's own text and against a real PostgreSQL in
// `advertisement-ownership.migration.pg.test.ts`. Claims 3 and 4 are properties
// of resolution, and they are proved here: every denial in the Wave 3 model is a
// denial BECAUSE membership is not consulted, and "is not consulted" is a
// property of the source rather than of a fixture.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { requireAdvertisementCommercialAuthority } from '../modules/advertisements/advertisement-ownership.authorization.js';
import { ADVERTISEMENT_OWNERSHIP_MIGRATION } from '../modules/advertisements/advertisement-ownership.constants.js';
import {
  commercialControllerOf,
  resolveAdvertisementOwnership,
} from '../modules/advertisements/advertisement-ownership.repository.js';
import { deterministicInitialIdentityId } from '../modules/business-identity/business-identity.constants.js';

// Source text is asserted verbatim; normalize CRLF so the assertions hold on
// checkouts where git materializes native line endings.
const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const migrationSql = (): string =>
  readSource(`../../../../supabase/migrations/${ADVERTISEMENT_OWNERSHIP_MIGRATION}`);

/**
 * The migration with its commentary removed.
 *
 * The header explains at length what this migration does not do, which means the
 * prose contains every term the negative assertions look for. Stripping `--`
 * lines is what makes those assertions about the SQL rather than about the
 * explanation of the SQL.
 */
const migrationStatements = (): string =>
  migrationSql()
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

/** The same idea for TypeScript: assert on code, not on the comment above it. */
const codeOf = (relative: string): string =>
  readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');

const businessA = '11111111-1111-4111-8111-111111111111';
const businessB = '22222222-2222-4222-8222-222222222222';
const expert = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';
const teamMember = '55555555-5555-4555-8555-555555555555';
const manageTeamMember = '66666666-6666-4666-8666-666666666666';
const adminLabelledMember = '77777777-7777-4777-8777-777777777777';
const reservedPermissionMember = '88888888-8888-4888-8888-888888888888';
const workspaceSelector = '99999999-9999-4999-8999-999999999999';
const platformAdmin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const AD_A = 'dddddddd-0000-4000-8000-000000000001';
const AD_B = 'dddddddd-0000-4000-8000-000000000002';
const AD_EXPERT = 'dddddddd-0000-4000-8000-000000000003';

/** A second identity the same owner created afterwards. Never a legacy anchor. */
const nativeIdentity = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ---------------------------------------------------------------------------
// A model of the tables the resolver joins, joined the way it joins them.
// ---------------------------------------------------------------------------
// It answers by shape rather than by script, so a query that changes its FROM or
// its WHERE stops matching instead of silently returning the previous fixture.
// It models NO constraint: the database refuses most of the states below, and a
// repository that only behaves while its constraints are intact is a repository
// that fails silently the one time they are not.

type AdSeed = {
  id: string;
  advertiser_id: string;
  advertiser_role?: string;
  commercial_owner_kind?: string | null;
  business_commercial_identity_id?: string | null;
  commercial_ownership_state?: string;
};
type IdentitySeed = { id: string; owner_user_id: string; status?: string; origin?: string };
type MapSeed = { business_account_id: string; bci_id: string };

const fakeDb = (seed: {
  ads?: AdSeed[];
  identities?: IdentitySeed[];
  maps?: MapSeed[];
}): Pool & { calls: number } => {
  const ads = seed.ads ?? [];
  const identities = seed.identities ?? [];
  const maps = seed.maps ?? [];
  const state = { calls: 0 };

  const db = {
    get calls() {
      return state.calls;
    },
    query: (sql: string, values: unknown[] = []) => {
      state.calls += 1;
      if (!sql.includes('FROM advertisements a')) return Promise.resolve({ rows: [] });

      const matched = ads.filter((ad) => ad.id === values[0]);
      const rows: unknown[] = [];

      for (const ad of matched) {
        const assignedId = ad.business_commercial_identity_id ?? null;
        const assigned = identities.find((i) => i.id === assignedId) ?? null;
        const assignedMap = maps.find((m) => m.bci_id === assignedId) ?? null;
        const ownMaps = maps.filter((m) => m.business_account_id === ad.advertiser_id);

        const base = {
          id: ad.id,
          advertiser_id: ad.advertiser_id,
          commercial_owner_kind: ad.commercial_owner_kind ?? null,
          business_commercial_identity_id: assignedId,
          commercial_ownership_state: ad.commercial_ownership_state ?? 'legacy_user_owned',
          advertiser_role: ad.advertiser_role ?? 'business',
          identity_id: assigned?.id ?? null,
          identity_owner_user_id: assigned?.owner_user_id ?? null,
          identity_status: assigned ? (assigned.status ?? 'active') : null,
          identity_origin: assigned ? (assigned.origin ?? 'legacy_business_account') : null,
          assigned_anchor_account_id: assignedMap?.business_account_id ?? null,
          advertiser_mapping_count: String(ownMaps.length),
        };

        // The own-mapping join fans out when a mapping is duplicated, exactly as
        // it would in PostgreSQL.
        if (ownMaps.length === 0) {
          rows.push({
            ...base,
            advertiser_initial_identity_id: null,
            advertiser_initial_identity_status: null,
            advertiser_initial_identity_origin: null,
          });
        } else {
          for (const own of ownMaps) {
            const ownIdentity = identities.find((i) => i.id === own.bci_id) ?? null;
            rows.push({
              ...base,
              advertiser_initial_identity_id: own.bci_id,
              advertiser_initial_identity_status: ownIdentity?.status ?? 'active',
              advertiser_initial_identity_origin: ownIdentity?.origin ?? 'legacy_business_account',
            });
          }
        }
      }

      return Promise.resolve({ rows });
    },
    // `pg` types `query` as an overload set this fixture has no reason to
    // reproduce; the repository only ever calls the (sql, values) form.
  } as unknown as Pool & { calls: number };

  return db;
};

/** The state migration 20260807090000 leaves behind for one legacy Business. */
const migratedBusiness = (accountId: string, adId: string) => ({
  ads: [
    {
      id: adId,
      advertiser_id: accountId,
      commercial_owner_kind: 'business',
      business_commercial_identity_id: deterministicInitialIdentityId(accountId),
      commercial_ownership_state: 'commercial_identity_owned',
    },
  ],
  identities: [{ id: deterministicInitialIdentityId(accountId), owner_user_id: accountId }],
  maps: [{ business_account_id: accountId, bci_id: deterministicInitialIdentityId(accountId) }],
});

// ===========================================================================
// The migration is additive
// ===========================================================================

describe('the ownership migration is additive', () => {
  it('rewrites no other commercial asset', () => {
    const sql = migrationStatements();

    // Services, jobs, plans, subscriptions, wallets and MHC balances are later
    // slices. Touching any of them here is exactly the scope creep the Wave 3
    // staging exists to prevent.
    for (const table of [
      'services',
      'jobs',
      'plans',
      'subscriptions',
      'wallets',
      'wallet_transactions',
      'mhc_action_charges',
      'mhc_job_activations',
      'bookings',
      'business_teams',
      'business_members',
      'business_profiles',
    ]) {
      expect(sql).not.toMatch(new RegExp(`UPDATE\\s+(public\\.)?${table}\\b`, 'i'));
      expect(sql).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+(public\\.)?${table}\\b`, 'i'));
      expect(sql).not.toMatch(new RegExp(`INSERT\\s+INTO\\s+(public\\.)?${table}\\b`, 'i'));
      expect(sql).not.toMatch(new RegExp(`ALTER\\s+TABLE\\s+(public\\.)?${table}\\b`, 'i'));
    }
  });

  it('writes to advertisements and nothing else', () => {
    const sql = migrationStatements();
    const written = [
      ...sql.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?(\w+)/gi),
      ...sql.matchAll(/\bUPDATE\s+(?:public\.)?(\w+)\s+(?:a\s+)?SET\b/gi),
      ...sql.matchAll(/\bDELETE\s+FROM\s+(?:public\.)?(\w+)/gi),
    ]
      .map((m) => m[1]!.toLowerCase())
      .filter((table, index, all) => all.indexOf(table) === index)
      // The precheck fingerprint is a temp table this migration creates and
      // drops; it holds no product data.
      .filter((table) => table !== 'advertisement_ownership_precheck');

    expect(written).toEqual(['advertisements']);
  });

  it('drops no column, renames nothing, and re-keys no advertisement', () => {
    const sql = migrationStatements();

    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/RENAME/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+(public\.)?advertisements\s+DROP/i);
    // The legacy anchor is never written. Every SET in the backfill names a new
    // column, so `advertiser_id` cannot move.
    expect(sql).not.toMatch(/SET[\s\S]{0,400}\badvertiser_id\s*=/i);
    expect(sql).not.toMatch(/\bid\s*=\s*gen_random_uuid\(\)/i);
  });

  it('adds every ownership column additively and nullable', () => {
    const sql = migrationStatements();

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS commercial_owner_kind');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS business_commercial_identity_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS commercial_ownership_state');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS commercial_ownership_assigned_at');
    // The only NOT NULL column carries a default, so an existing row satisfies
    // it without being rewritten.
    expect(sql).toContain("DEFAULT 'legacy_user_owned'");
  });

  it('anchors ownership to the persisted legacy map with a key, not a convention', () => {
    const sql = migrationStatements();

    // The whole no-asset-mixing guarantee. Targeting the MAP rather than the
    // identity table is what excludes a natively created second identity of the
    // same owner: a native identity is never mapped.
    expect(sql).toContain('FOREIGN KEY (business_commercial_identity_id, advertiser_id)');
    expect(sql).toContain(
      'REFERENCES public.business_commercial_identity_legacy_map (bci_id, business_account_id)',
    );
    // Removing a mapping row must never delete somebody's advertisements.
    expect(sql).not.toMatch(
      /REFERENCES\s+public\.business_commercial_identity_legacy_map[\s\S]{0,120}ON\s+DELETE\s+CASCADE/i,
    );
  });

  it('backfills through the map alone, never through the owner column', () => {
    const sql = migrationStatements();

    expect(sql).toContain('FROM public.business_commercial_identity_legacy_map m');
    expect(sql).toContain('WHERE m.business_account_id = a.advertiser_id');
    // Deriving the identity from ownership is precisely how a legacy asset ends
    // up on somebody's second, native identity.
    expect(sql).not.toMatch(/SET[\s\S]{0,400}owner_user_id/i);
  });

  it('is idempotent and concurrency-safe by predicate', () => {
    const sql = migrationStatements();

    expect(sql).toContain('AND a.business_commercial_identity_id IS NULL');
    expect(sql).toContain("AND a.commercial_ownership_state = 'legacy_user_owned'");
    // Every constraint addition is guarded, because ALTER TABLE ADD CONSTRAINT
    // has no IF NOT EXISTS and a migration that cannot replay cannot be retried.
    expect(sql).toContain('FROM pg_constraint');
  });

  it('reconciles itself before it commits', () => {
    const sql = migrationStatements();

    for (const claim of [
      'advertisement(s) before the backfill',
      'but % distinct id(s)',
      'an existing advertisement column changed',
      'assigned to a commercial identity',
      "do not point at their advertiser''s initial BCI",
      'point at an identity owned by a different account',
      'were assigned to a natively created identity',
      'name a commercial identity that does not exist',
      'were given commercial identity ownership',
      'carry a state their ownership columns contradict',
    ]) {
      expect(sql).toContain(claim);
    }
  });

  it('refuses a reassociation Wave 3 has not designed', () => {
    const sql = migrationStatements();

    expect(sql).toContain('trg_advertisements_immutable_commercial_owner');
    expect(sql).toContain('is immutable once assigned');
  });

  it('grants no browser role a route to ownership', () => {
    const sql = migrationStatements();

    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
  });

  it('touches no migration that came before it', () => {
    // Stated as a property of this file's own name: it sorts after the BCI
    // spine, so the replay applies it on top rather than beside.
    expect(ADVERTISEMENT_OWNERSHIP_MIGRATION > '20260806090000').toBe(true);
  });
});

// ===========================================================================
// Resolution — the canonical owner
// ===========================================================================

describe('resolving a Business advertisement', () => {
  it('resolves the canonical owner the advertisement records', async () => {
    const db = fakeDb(migratedBusiness(businessA, AD_A));

    const resolution = await resolveAdvertisementOwnership(db, AD_A);

    expect(resolution).toMatchObject({
      kind: 'commercial_identity',
      owner: {
        advertisementId: AD_A,
        legacyAdvertiserId: businessA,
        ownerKind: 'business',
        identityId: deterministicInitialIdentityId(businessA),
        identityOwnerUserId: businessA,
        source: 'assigned',
      },
    });
  });

  it('resolves an un-backfilled Business campaign through the legacy map', async () => {
    // No assigned column yet — a Business that registered after the backfill
    // ran. The compatibility rule still reaches the right commercial identity,
    // which is what makes this a dual READ rather than a dual STORE.
    const db = fakeDb({
      ads: [{ id: AD_A, advertiser_id: businessA }],
      identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
      maps: [{ business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) }],
    });

    const resolution = await resolveAdvertisementOwnership(db, AD_A);

    expect(resolution).toMatchObject({
      kind: 'commercial_identity',
      owner: {
        identityId: deterministicInitialIdentityId(businessA),
        identityOwnerUserId: businessA,
        source: 'legacy_compatibility',
      },
    });
  });

  it('produces one answer when the assigned owner and the legacy anchor agree', async () => {
    const assigned = await resolveAdvertisementOwnership(
      fakeDb(migratedBusiness(businessA, AD_A)),
      AD_A,
    );
    const viaLegacy = await resolveAdvertisementOwnership(
      fakeDb({
        ads: [{ id: AD_A, advertiser_id: businessA }],
        identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
        ],
      }),
      AD_A,
    );

    expect(commercialControllerOf(assigned)).toBe(commercialControllerOf(viaLegacy));
    expect(assigned).toMatchObject({
      owner: { identityId: deterministicInitialIdentityId(businessA) },
    });
    expect(viaLegacy).toMatchObject({
      owner: { identityId: deterministicInitialIdentityId(businessA) },
    });
  });

  it('reports an unknown advertisement rather than an empty owner', async () => {
    const db = fakeDb(migratedBusiness(businessA, AD_A));

    expect(await resolveAdvertisementOwnership(db, AD_B)).toEqual({ kind: 'not_found' });
  });

  it('reads the row every time, so no earlier answer can be served to a later caller', async () => {
    const db = fakeDb(migratedBusiness(businessA, AD_A));

    await resolveAdvertisementOwnership(db, AD_A);
    await resolveAdvertisementOwnership(db, AD_A);

    expect(db.calls).toBe(2);
    // ...and no module-level cache exists to make that accidental.
    const source = codeOf('../modules/advertisements/advertisement-ownership.repository.ts');
    expect(source).not.toMatch(/\bnew Map\(|\bcache\b/i);
  });
});

// ===========================================================================
// Resolution — every contradiction fails closed
// ===========================================================================

describe('contradictory ownership fails closed', () => {
  const cases: Array<[string, Parameters<typeof fakeDb>[0], string]> = [
    [
      'an identity owned by another Business',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_owner_kind: 'business',
            business_commercial_identity_id: deterministicInitialIdentityId(businessB),
            commercial_ownership_state: 'commercial_identity_owned',
          },
        ],
        identities: [
          { id: deterministicInitialIdentityId(businessA), owner_user_id: businessA },
          { id: deterministicInitialIdentityId(businessB), owner_user_id: businessB },
        ],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
          { business_account_id: businessB, bci_id: deterministicInitialIdentityId(businessB) },
        ],
      },
      'owner_mismatch',
    ],
    [
      'a second identity the same owner created natively',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_owner_kind: 'business',
            business_commercial_identity_id: nativeIdentity,
            commercial_ownership_state: 'commercial_identity_owned',
          },
        ],
        identities: [
          { id: deterministicInitialIdentityId(businessA), owner_user_id: businessA },
          { id: nativeIdentity, owner_user_id: businessA, origin: 'native' },
        ],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
        ],
      },
      'non_authoritative_identity',
    ],
    [
      'an identity that does not exist',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_owner_kind: 'business',
            business_commercial_identity_id: nativeIdentity,
            commercial_ownership_state: 'commercial_identity_owned',
          },
        ],
        identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
        ],
      },
      'unknown_identity',
    ],
    [
      'a mapped identity that is not the deterministic one for its account',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_owner_kind: 'business',
            business_commercial_identity_id: nativeIdentity,
            commercial_ownership_state: 'commercial_identity_owned',
          },
        ],
        identities: [{ id: nativeIdentity, owner_user_id: businessA }],
        maps: [{ business_account_id: businessA, bci_id: nativeIdentity }],
      },
      'non_authoritative_identity',
    ],
    [
      'an anchored identity that does not declare legacy origin',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_owner_kind: 'business',
            business_commercial_identity_id: deterministicInitialIdentityId(businessA),
            commercial_ownership_state: 'commercial_identity_owned',
          },
        ],
        identities: [
          {
            id: deterministicInitialIdentityId(businessA),
            owner_user_id: businessA,
            origin: 'native',
          },
        ],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
        ],
      },
      'origin_conflict',
    ],
    [
      'a state column that claims ownership the row does not hold',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_ownership_state: 'commercial_identity_owned',
          },
        ],
        identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
        ],
      },
      'state_conflict',
    ],
    [
      'a state column that denies ownership the row does hold',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_owner_kind: 'business',
            business_commercial_identity_id: deterministicInitialIdentityId(businessA),
            commercial_ownership_state: 'legacy_user_owned',
          },
        ],
        identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
        ],
      },
      'state_conflict',
    ],
    [
      'more than one legacy mapping for the advertiser',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_owner_kind: 'business',
            business_commercial_identity_id: deterministicInitialIdentityId(businessA),
            commercial_ownership_state: 'commercial_identity_owned',
          },
        ],
        identities: [
          { id: deterministicInitialIdentityId(businessA), owner_user_id: businessA },
          { id: nativeIdentity, owner_user_id: businessA },
        ],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
          { business_account_id: businessA, bci_id: nativeIdentity },
        ],
      },
      'duplicate_legacy_mappings',
    ],
    [
      'a row an operator has fenced',
      {
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_ownership_state: 'quarantined_ambiguous',
          },
        ],
        identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
        maps: [
          { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
        ],
      },
      'quarantined',
    ],
  ];

  for (const [label, seed, reason] of cases) {
    it(`refuses ${label}`, async () => {
      const resolution = await resolveAdvertisementOwnership(fakeDb(seed), AD_A);

      expect(resolution).toEqual({
        kind: 'ambiguous',
        ambiguity: { reason, legacyAdvertiserId: businessA },
      });
      // The refusal that matters: an invalid canonical owner NEVER degrades into
      // the legacy owner. A read that fell through here would act on an owner
      // the row does not name.
      expect(commercialControllerOf(resolution)).toBeNull();
    });
  }
});

// ===========================================================================
// Personal providers are preserved, not reinterpreted
// ===========================================================================

describe('personal provider compatibility', () => {
  it('leaves an Expert campaign on its legacy owner, awaiting the PCI slice', async () => {
    const db = fakeDb({
      ads: [{ id: AD_EXPERT, advertiser_id: expert, advertiser_role: 'expert' }],
      identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
      maps: [{ business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) }],
    });

    const resolution = await resolveAdvertisementOwnership(db, AD_EXPERT);

    expect(resolution).toEqual({
      kind: 'legacy_user',
      owner: {
        advertisementId: AD_EXPERT,
        legacyAdvertiserId: expert,
        advertiserRole: 'expert',
        ownershipState: 'legacy_user_owned',
        reason: 'awaiting_personal_commercial_identity',
      },
    });
    // ...and it is emphatically not Business-owned.
    expect(commercialControllerOf(resolution)).toBe(expert);
  });

  it('does the same for a Craftsman', async () => {
    const db = fakeDb({
      ads: [{ id: AD_EXPERT, advertiser_id: expert, advertiser_role: 'craftsman' }],
    });

    expect(await resolveAdvertisementOwnership(db, AD_EXPERT)).toMatchObject({
      kind: 'legacy_user',
      owner: { reason: 'awaiting_personal_commercial_identity' },
    });
  });

  it('keeps a Business with no mapping working, and says why', async () => {
    // A Business registered after the spine migration. Fencing its campaign for
    // a gap it did not cause would be a regression, and the legacy anchor is the
    // same account its identity would name anyway.
    const db = fakeDb({ ads: [{ id: AD_A, advertiser_id: businessA }] });

    expect(await resolveAdvertisementOwnership(db, AD_A)).toMatchObject({
      kind: 'legacy_user',
      owner: { legacyAdvertiserId: businessA, reason: 'no_business_commercial_identity' },
    });
  });

  it('invents no Personal Commercial Identity anywhere in the slice', () => {
    const sql = migrationStatements();
    const resolver = codeOf('../modules/advertisements/advertisement-ownership.repository.ts');

    // The slice names the ABSENCE of a PCI — `awaiting_personal_commercial_identity`
    // is a compatibility reason, and naming what is missing is the opposite of
    // building it. What must not exist is the entity itself.
    expect(sql).not.toMatch(/personal_commercial_identities/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(resolver).not.toMatch(/personal_commercial_identities/i);
    expect(resolver).not.toMatch(/personal_commercial_identity_id/i);
  });
});

// ===========================================================================
// Commercial authority
// ===========================================================================

describe('Business advertisement authorization', () => {
  const businessDb = () => fakeDb(migratedBusiness(businessA, AD_A));

  it('allows the canonical Business account controlling the owning identity', async () => {
    const resolution = await requireAdvertisementCommercialAuthority(businessDb(), {
      advertisementId: AD_A,
      actorUserId: businessA,
    });

    expect(resolution).toMatchObject({
      kind: 'commercial_identity',
      owner: { identityOwnerUserId: businessA },
    });
  });

  // Each of these is a different story about why somebody believes they may act
  // for the Business. The API tells all of them the same thing, because the
  // decision reads none of the state their story is about.
  for (const [label, actor] of [
    ['an unrelated user', outsider],
    ['a Business team member', teamMember],
    ['a member holding manage_team', manageTeamMember],
    ['a member whose team role is labelled Admin', adminLabelledMember],
    ['a member carrying a reserved permission', reservedPermissionMember],
    ['a user who has merely selected the Business workspace', workspaceSelector],
    ['a platform administrator', platformAdmin],
  ] as const) {
    it(`denies ${label}`, async () => {
      await expect(
        requireAdvertisementCommercialAuthority(businessDb(), {
          advertisementId: AD_A,
          actorUserId: actor,
        }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    });
  }

  it('denies the owner acting through a second identity they control', async () => {
    // Same human, different commercial identity. The campaign belongs to the
    // legacy Business, and a native identity does not inherit its assets.
    const db = fakeDb({
      ads: [
        {
          id: AD_A,
          advertiser_id: businessA,
          commercial_owner_kind: 'business',
          business_commercial_identity_id: nativeIdentity,
          commercial_ownership_state: 'commercial_identity_owned',
        },
      ],
      identities: [
        { id: deterministicInitialIdentityId(businessA), owner_user_id: businessA },
        { id: nativeIdentity, owner_user_id: businessA, origin: 'native' },
      ],
      maps: [{ business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) }],
    });

    await expect(
      requireAdvertisementCommercialAuthority(db, {
        advertisementId: AD_A,
        actorUserId: businessA,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_OWNERSHIP_AMBIGUOUS',
      details: { reason: 'non_authoritative_identity' },
    });
  });

  it('reports a corrupt row only to the account it names as advertiser', async () => {
    const db = () =>
      fakeDb({
        ads: [
          {
            id: AD_A,
            advertiser_id: businessA,
            commercial_ownership_state: 'quarantined_ambiguous',
          },
        ],
      });

    await expect(
      requireAdvertisementCommercialAuthority(db(), {
        advertisementId: AD_A,
        actorUserId: businessA,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'AD_OWNERSHIP_AMBIGUOUS' });

    // To everybody else it is indistinguishable from a campaign they do not own,
    // which is what it is.
    await expect(
      requireAdvertisementCommercialAuthority(db(), {
        advertisementId: AD_A,
        actorUserId: outsider,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('preserves the legacy authorization a personal provider has today', async () => {
    const db = () =>
      fakeDb({ ads: [{ id: AD_EXPERT, advertiser_id: expert, advertiser_role: 'expert' }] });

    await expect(
      requireAdvertisementCommercialAuthority(db(), {
        advertisementId: AD_EXPERT,
        actorUserId: expert,
      }),
    ).resolves.toMatchObject({ kind: 'legacy_user' });

    await expect(
      requireAdvertisementCommercialAuthority(db(), {
        advertisementId: AD_EXPERT,
        actorUserId: outsider,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('returns the two refusals the advertisement routes already return', async () => {
    await expect(
      requireAdvertisementCommercialAuthority(businessDb(), {
        advertisementId: AD_B,
        actorUserId: businessA,
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'AD_NOT_FOUND' });
  });

  it('consults no membership, permission or workspace-selection state', () => {
    const gate = codeOf('../modules/advertisements/advertisement-ownership.authorization.ts');
    const resolver = codeOf('../modules/advertisements/advertisement-ownership.repository.ts');

    // The mechanism, not the intention: a permission cannot be wired to a
    // decision that never reads it.
    for (const forbidden of [
      'business_members',
      'business_team_roles',
      'business_team_invites',
      'manage_team',
      'manage_services',
      'manage_jobs',
      'manage_reservations',
      'view_wallet',
      'view_analytics',
      'manage_support_disputes',
      'selected_business',
      'hasPermission',
    ]) {
      expect(gate).not.toContain(forbidden);
      expect(resolver).not.toContain(forbidden);
    }
  });

  it('offers no administrative bypass', () => {
    const gate = codeOf('../modules/advertisements/advertisement-ownership.authorization.ts');

    // Platform moderation is gated on the admin routes by admin permissions and
    // does not pass through here. There is no parameter through which an
    // administrator could become the Business.
    expect(gate).not.toMatch(/isAdmin|is_admin|adminOverride|bypass/i);
  });
});

// ===========================================================================
// No asset mixing
// ===========================================================================

describe('no advertisement crosses an identity boundary', () => {
  const twoBusinesses = () => ({
    ads: [migratedBusiness(businessA, AD_A).ads[0]!, migratedBusiness(businessB, AD_B).ads[0]!],
    identities: [
      { id: deterministicInitialIdentityId(businessA), owner_user_id: businessA },
      { id: deterministicInitialIdentityId(businessB), owner_user_id: businessB },
    ],
    maps: [
      { business_account_id: businessA, bci_id: deterministicInitialIdentityId(businessA) },
      { business_account_id: businessB, bci_id: deterministicInitialIdentityId(businessB) },
    ],
  });

  it("never reports Business A's campaign as owned by Business B's identity", async () => {
    const db = fakeDb(twoBusinesses());

    const a = await resolveAdvertisementOwnership(db, AD_A);
    const b = await resolveAdvertisementOwnership(db, AD_B);

    expect(a).toMatchObject({ owner: { identityId: deterministicInitialIdentityId(businessA) } });
    expect(b).toMatchObject({ owner: { identityId: deterministicInitialIdentityId(businessB) } });
    expect(commercialControllerOf(a)).toBe(businessA);
    expect(commercialControllerOf(b)).toBe(businessB);
  });

  it('resolves each campaign from its own row, in either order', async () => {
    const first = fakeDb(twoBusinesses());
    const second = fakeDb(twoBusinesses());

    await resolveAdvertisementOwnership(first, AD_A);
    const bAfterA = await resolveAdvertisementOwnership(first, AD_B);

    await resolveAdvertisementOwnership(second, AD_B);
    const bAlone = await resolveAdvertisementOwnership(second, AD_B);

    // Reading A first changes nothing about B. Ownership state is per row and
    // per read, so no ordering can bleed one identity's answer into another's.
    expect(bAfterA).toEqual(bAlone);
  });

  it('lets neither Business act on the other', async () => {
    const db = () => fakeDb(twoBusinesses());

    await expect(
      requireAdvertisementCommercialAuthority(db(), {
        advertisementId: AD_A,
        actorUserId: businessB,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      requireAdvertisementCommercialAuthority(db(), {
        advertisementId: AD_B,
        actorUserId: businessA,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ===========================================================================
// The write path applies the same rule
// ===========================================================================

describe('a new campaign is stamped by the same rule the backfill uses', () => {
  it('reads the authoritative map and nothing else', () => {
    const repo = codeOf('../modules/advertisements/advertisements.repository.ts');
    const stamp = repo.slice(repo.indexOf('stampCommercialOwnerInTx'));

    expect(stamp).toContain('FROM business_commercial_identity_legacy_map m');
    expect(stamp).toContain('m.business_account_id = a.advertiser_id');
    expect(stamp).toContain('a.business_commercial_identity_id IS NULL');
    // Never from ownership, which would let a second native identity claim a
    // campaign the legacy Business created.
    expect(stamp.slice(0, stamp.indexOf('async getAdById'))).not.toContain('owner_user_id');
  });

  it('runs inside the creating transaction', async () => {
    const { AdvertisementsRepository } =
      await import('../modules/advertisements/advertisements.repository.js');
    const repo = new AdvertisementsRepository();
    const query = vi.fn().mockResolvedValue({ rows: [] });

    const result = await repo.stampCommercialOwnerInTx(
      { query } as never,
      'dddddddd-0000-4000-8000-000000000009',
    );

    // The caller's client, not a fresh pool connection: a campaign and its
    // commercial owner commit together or not at all.
    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});

// ===========================================================================
// Billing and renewal are not redesigned
// ===========================================================================

describe('the billing boundary is untouched', () => {
  it('charges the advertisement its own stored advertiser, as it always has', () => {
    const billing = codeOf('../modules/advertisements/advertisement-billing.service.ts');

    // Ownership does not move money in Wave 3: the BCI has no balance of its
    // own, and MHC balance ownership is a later slice. The composite foreign key
    // is what makes this safe — the owning identity's controller IS
    // `advertiser_id`, so there is no account a cross-identity charge could
    // reach.
    expect(billing).toContain('userId: ad.advertiser_id');
    expect(billing).not.toContain('business_commercial_identity_id');
  });

  it('introduces no price and resurrects no EGP wallet charging', () => {
    const sql = migrationStatements();

    expect(sql).not.toMatch(/mhc_action_prices/i);
    expect(sql).not.toMatch(/\bwallet/i);
    expect(sql).not.toMatch(/amount_paid\s*=/i);
  });
});
