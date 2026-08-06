// ---------------------------------------------------------------------------
// Business Commercial Identity — compatibility, resolution and authority.
// ---------------------------------------------------------------------------
// The Wave 3 slice makes five claims (16-wave-3-scope.md §1.12 B):
//
//   B1  a legacy Business account maps to exactly one initial BCI,
//       deterministically; re-running creates none
//   B2  team/workspace IDs remain unchanged across the migration
//   B3  memberships, invitations, roles and audit history remain unchanged,
//       including roles carrying a reserved permission
//   B4  user-owned historical assets remain readable throughout the
//       compatibility period
//   B5  one owner may control multiple BCIs without asset mixing
//
// B1 is proved twice: the deterministic rule is proved here without a database,
// and the backfill that applies it is proved against a real PostgreSQL in
// `business-identity.migration.pg.test.ts`. B2, B3 and B4 are claims about what
// the migration does NOT do, so they are asserted against the migration's own
// text here and against real tables there.
//
// The authorization half needs no database at all: every denial in the Wave 3
// model is a denial BECAUSE membership is not consulted, and "is not consulted"
// is a property of the source, not of a fixture.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  requireCommercialAuthority,
  resolveBusinessIdentityContext,
  resolveOwnInitialBusinessIdentity,
} from '../modules/business-identity/business-identity.authorization.js';
import {
  BCI_COMPATIBILITY_MIGRATION,
  INITIAL_BCI_NAMESPACE,
  deterministicInitialIdentityId,
} from '../modules/business-identity/business-identity.constants.js';
import {
  listIdentitiesControlledBy,
  projectLegacyBusinessProfile,
  resolveIdentityById,
  resolveInitialIdentityForBusinessAccount,
} from '../modules/business-identity/business-identity.repository.js';

// Source text is asserted verbatim; normalize CRLF so the assertions hold on
// checkouts where git materializes native line endings.
const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const migrationSql = (): string =>
  readSource(`../../../../supabase/migrations/${BCI_COMPATIBILITY_MIGRATION}`);

/**
 * The migration with its commentary removed.
 *
 * The header explains at length what this migration does not do, which means
 * the prose contains every term the negative assertions look for. Stripping
 * `--` lines is what makes those assertions about the SQL rather than about the
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
const outsider = '33333333-3333-4333-8333-333333333333';
const teamMember = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// A model of the two new tables, joined the way the repository joins them.
// ---------------------------------------------------------------------------
// It answers by shape rather than by script, so a query that changes its WHERE
// clause stops matching instead of silently returning the previous fixture.

type IdentitySeed = {
  id: string;
  owner_user_id: string;
  status?: string;
  origin?: string;
};
type MapSeed = { business_account_id: string; bci_id: string };
type ProfileSeed = { id: string; user_id: string; company_name: string | null };

const fakeDb = (seed: {
  identities?: IdentitySeed[];
  maps?: MapSeed[];
  profiles?: ProfileSeed[];
}): Pool => {
  const identities = seed.identities ?? [];
  const maps = seed.maps ?? [];
  const profiles = seed.profiles ?? [];

  return {
    query: (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM business_profiles')) {
        return Promise.resolve({ rows: profiles.filter((p) => p.user_id === values[0]) });
      }

      let selected = identities;
      if (sql.includes('WHERE b.id = $1')) {
        selected = identities.filter((i) => i.id === values[0]);
      } else if (sql.includes('SELECT bci_id FROM business_commercial_identity_legacy_map')) {
        const ids = maps.filter((m) => m.business_account_id === values[0]).map((m) => m.bci_id);
        selected = identities.filter((i) => ids.includes(i.id));
      } else if (sql.includes('WHERE b.owner_user_id = $1')) {
        selected = identities.filter((i) => i.owner_user_id === values[0]);
      }

      const rows: unknown[] = [];
      for (const identity of selected) {
        const mapped = maps.filter((m) => m.bci_id === identity.id);
        const base = {
          id: identity.id,
          owner_user_id: identity.owner_user_id,
          status: identity.status ?? 'active',
          origin: identity.origin ?? 'legacy_business_account',
          created_at: new Date('2026-08-06T00:00:00.000Z'),
          updated_at: new Date('2026-08-06T00:00:00.000Z'),
          mapping_count: String(mapped.length),
        };
        if (mapped.length === 0) {
          rows.push({ ...base, mapped_account_id: null });
        } else {
          for (const m of mapped) rows.push({ ...base, mapped_account_id: m.business_account_id });
        }
      }
      return Promise.resolve({ rows });
    },
    // `pg` types `query` as an overload set this fixture has no reason to
    // reproduce; the repository only ever calls the (sql, values) form.
  } as unknown as Pool;
};

/** The state the migration leaves behind for one legacy Business account. */
const migratedBusiness = (accountId: string) => ({
  identity: { id: deterministicInitialIdentityId(accountId), owner_user_id: accountId },
  map: { business_account_id: accountId, bci_id: deterministicInitialIdentityId(accountId) },
});

// ===========================================================================
// B1 — deterministic mapping
// ===========================================================================

describe('B1 — a legacy Business account maps to exactly one initial BCI', () => {
  it('derives the same identifier for the same account, every time', () => {
    const first = deterministicInitialIdentityId(businessA);
    const second = deterministicInitialIdentityId(businessA);

    expect(first).toBe(second);
    // Stated literally rather than recomputed: a change to the namespace, the
    // hash or the nibble rewriting would re-key every existing Business, and
    // this is the assertion that refuses to let that happen quietly.
    expect(first).toBe('744e75ee-46fb-3457-91cf-062de02d85c2');
  });

  it('derives a different identifier for a different account', () => {
    expect(deterministicInitialIdentityId(businessA)).not.toBe(
      deterministicInitialIdentityId(businessB),
    );
  });

  it('produces a well-formed RFC 4122 identifier, version 3 and variant 10xx', () => {
    for (const account of [businessA, businessB, outsider, teamMember]) {
      expect(deterministicInitialIdentityId(account)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('computes the identifier the database computes', () => {
    const sql = migrationSql();

    // One namespace string, in two implementations. If they ever diverge, the
    // migration and the request path would disagree about which BCI is a
    // Business's initial one — which is the whole failure this slice prevents.
    expect(sql).toContain(INITIAL_BCI_NAMESPACE);
    expect(sql).toContain("overlay(v_hex PLACING '3' FROM 13 FOR 1)");
    expect(sql).toContain("substr('89ab89ab89ab89ab'");
  });

  it('re-running the mapping creates nothing new', () => {
    const sql = migrationSql();

    // Convergence is structural: the deterministic id is the primary key, so a
    // second run collides rather than inserting, and so do two concurrent runs.
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(sql).toContain('ON CONFLICT (business_account_id) DO NOTHING');
    expect(sql).toContain('business_account_id  UUID PRIMARY KEY');
    expect(sql).toContain(
      'CONSTRAINT uq_business_commercial_identity_legacy_map_bci UNIQUE (bci_id)',
    );
  });

  it('cannot map a Business to an identity that is not its deterministic one', () => {
    const sql = migrationSql();

    expect(sql).toContain('CONSTRAINT chk_business_commercial_identity_legacy_map_deterministic');
    expect(sql).toContain(
      'CHECK (bci_id = public.business_commercial_identity_deterministic_id(business_account_id))',
    );
    // ...and the mapped identity's owner is the mapped account, as a key.
    expect(sql).toContain('FOREIGN KEY (bci_id, business_account_id)');
    expect(sql).toContain('REFERENCES public.business_commercial_identities (id, owner_user_id)');
  });
});

// ===========================================================================
// B2 / B3 / B4 — what the migration does not touch
// ===========================================================================

describe('B2, B3, B4 — the migration is additive', () => {
  it('renumbers no workspace and rewrites no membership, role, invitation or audit row', () => {
    const sql = migrationStatements();

    for (const table of [
      'business_teams',
      'business_members',
      'business_team_roles',
      'business_team_invites',
      'business_team_audit_log',
      'business_profiles',
    ]) {
      expect(sql).not.toMatch(new RegExp(`UPDATE\\s+(public\\.)?${table}\\b`, 'i'));
      expect(sql).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+(public\\.)?${table}\\b`, 'i'));
      expect(sql).not.toMatch(new RegExp(`ALTER\\s+TABLE\\s+(public\\.)?${table}\\b`, 'i'));
      expect(sql).not.toMatch(new RegExp(`INSERT\\s+INTO\\s+(public\\.)?${table}\\b`, 'i'));
    }
  });

  it('writes only to the two tables it creates', () => {
    const sql = migrationStatements();
    const written = [
      ...sql.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?(\w+)/gi),
      ...sql.matchAll(/\bUPDATE\s+(?:public\.)?(\w+)\s+SET\b/gi),
      ...sql.matchAll(/\bDELETE\s+FROM\s+(?:public\.)?(\w+)/gi),
    ]
      .map((m) => m[1]!.toLowerCase())
      .filter((table, index, all) => all.indexOf(table) === index);

    expect(written.sort()).toEqual([
      'business_commercial_identities',
      'business_commercial_identity_legacy_map',
    ]);
  });

  it('adds no owner column to any existing commercial asset', () => {
    const sql = migrationStatements();

    // Asset re-association is a later slice, and doing it here would be the
    // destructive re-keying 09 §4.4 forbids. The only ALTER TABLE this
    // migration issues is the RLS posture for the two tables it just created.
    expect(sql).not.toMatch(/\bADD\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|POLICY)\b/i);
    const alters = [...sql.matchAll(/ALTER\s+TABLE\s+(\S+)/gi)].map((m) => m[1]!);
    expect(alters).toEqual(['public.%I']);
  });

  it('keeps the backend-only RLS posture rather than relaxing it', () => {
    const sql = migrationStatements();

    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE public.%I FROM anon, authenticated');
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });

  it('introduces no adjacent Wave 3 subsystem', () => {
    const sql = migrationStatements().toLowerCase();

    for (const forbidden of [
      'personal_commercial',
      'engagement',
      'settlement',
      'fulfillment_component',
      'proposal',
      'mhc_job_activations',
      'verified_gmv',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// Resolution — never a guess, never a first row
// ===========================================================================

describe('BCI resolution', () => {
  it('resolves a legacy Business account to its initial identity', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({ identities: [a.identity], maps: [a.map] });

    const resolution = await resolveInitialIdentityForBusinessAccount(db, businessA);

    expect(resolution.kind).toBe('found');
    if (resolution.kind !== 'found') return;
    expect(resolution.identity.id).toBe(deterministicInitialIdentityId(businessA));
    expect(resolution.identity.ownerUserId).toBe(businessA);
    expect(resolution.legacy?.businessAccountId).toBe(businessA);
  });

  it('resolves the same identity by its own id', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({ identities: [a.identity], maps: [a.map] });

    const byId = await resolveIdentityById(db, a.identity.id);

    expect(byId.kind).toBe('found');
    if (byId.kind !== 'found') return;
    expect(byId.identity.ownerUserId).toBe(businessA);
  });

  it('reports a missing mapping as absence, not as corruption', async () => {
    const db = fakeDb({ identities: [], maps: [] });

    expect((await resolveInitialIdentityForBusinessAccount(db, businessA)).kind).toBe('not_found');
    expect((await resolveIdentityById(db, deterministicInitialIdentityId(businessA))).kind).toBe(
      'not_found',
    );
  });

  it('reports a Business carrying two initial identities as ambiguous', async () => {
    const strayId = deterministicInitialIdentityId('stray');
    const a = migratedBusiness(businessA);
    const db = fakeDb({
      identities: [a.identity, { id: strayId, owner_user_id: businessA }],
      maps: [a.map, { business_account_id: businessA, bci_id: strayId }],
    });

    const resolution = await resolveInitialIdentityForBusinessAccount(db, businessA);

    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind !== 'ambiguous') return;
    expect(resolution.ambiguity.reason).toBe('multiple_identities_resolved');
  });

  it('reports one identity mapped from two Businesses as ambiguous', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({
      identities: [a.identity],
      maps: [a.map, { business_account_id: businessB, bci_id: a.identity.id }],
    });

    const resolution = await resolveIdentityById(db, a.identity.id);

    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind !== 'ambiguous') return;
    expect(resolution.ambiguity.reason).toBe('duplicate_legacy_mappings');
  });

  it('reports a mapping whose owner disagrees with the identity as ambiguous', async () => {
    const identityId = deterministicInitialIdentityId(businessA);
    const db = fakeDb({
      identities: [{ id: identityId, owner_user_id: businessA }],
      maps: [{ business_account_id: businessB, bci_id: identityId }],
    });

    const resolution = await resolveIdentityById(db, identityId);

    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind !== 'ambiguous') return;
    expect(resolution.ambiguity.reason).toBe('owner_mismatch');
  });

  it('reports an initial identity with no legacy Business behind it as ambiguous', async () => {
    const db = fakeDb({
      identities: [{ id: deterministicInitialIdentityId(businessA), owner_user_id: businessA }],
      maps: [],
    });

    const resolution = await resolveIdentityById(db, deterministicInitialIdentityId(businessA));

    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind !== 'ambiguous') return;
    expect(resolution.ambiguity.reason).toBe('orphan_initial_identity');
  });

  it('accepts a natively created identity without a legacy anchor', async () => {
    const nativeId = '55555555-5555-4555-8555-555555555555';
    const db = fakeDb({
      identities: [{ id: nativeId, owner_user_id: businessA, origin: 'native' }],
      maps: [],
    });

    const resolution = await resolveIdentityById(db, nativeId);

    expect(resolution.kind).toBe('found');
    if (resolution.kind !== 'found') return;
    expect(resolution.legacy).toBeNull();
  });

  it('carries an inactive lifecycle state through resolution rather than hiding it', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({
      identities: [{ ...a.identity, status: 'archived' }],
      maps: [a.map],
    });

    const resolution = await resolveIdentityById(db, a.identity.id);

    expect(resolution.kind).toBe('found');
    if (resolution.kind !== 'found') return;
    expect(resolution.identity.status).toBe('archived');
  });
});

// ===========================================================================
// Compatibility projection
// ===========================================================================

describe('compatibility projection to the legacy Business profile', () => {
  it('resolves the same business_profiles row the legacy read resolves', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({
      identities: [a.identity],
      maps: [a.map],
      profiles: [{ id: 'profile-a', user_id: businessA, company_name: 'Alpha Engineering' }],
    });

    const resolution = await resolveIdentityById(db, a.identity.id);
    expect(resolution.kind).toBe('found');
    if (resolution.kind !== 'found') return;

    const projection = await projectLegacyBusinessProfile(db, resolution.identity);

    expect(projection.businessAccountId).toBe(businessA);
    expect(projection.businessProfileId).toBe('profile-a');
    expect(projection.companyName).toBe('Alpha Engineering');
  });

  it('exposes no internal migration provenance', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({
      identities: [a.identity],
      maps: [a.map],
      profiles: [{ id: 'profile-a', user_id: businessA, company_name: 'Alpha Engineering' }],
    });

    const resolution = await resolveIdentityById(db, a.identity.id);
    if (resolution.kind !== 'found') throw new Error('expected a resolved identity');
    const projection = await projectLegacyBusinessProfile(db, resolution.identity);

    expect(Object.keys(projection).sort()).toEqual([
      'businessAccountId',
      'businessProfileId',
      'companyName',
      'identityId',
    ]);
    // `created_by_migration` is provenance for an auditor with database access.
    // It is not selected by any read in this module.
    expect(
      readSource('../modules/business-identity/business-identity.repository.ts'),
    ).not.toContain('created_by_migration,');
    expect(JSON.stringify(projection)).not.toContain('created_by_migration');
  });

  it('returns no profile rather than choosing one if the unique key is violated', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({
      identities: [a.identity],
      maps: [a.map],
      profiles: [
        { id: 'profile-a', user_id: businessA, company_name: 'Alpha' },
        { id: 'profile-a2', user_id: businessA, company_name: 'Alpha (dupe)' },
      ],
    });

    const resolution = await resolveIdentityById(db, a.identity.id);
    if (resolution.kind !== 'found') throw new Error('expected a resolved identity');

    const projection = await projectLegacyBusinessProfile(db, resolution.identity);

    expect(projection.businessProfileId).toBeNull();
    expect(projection.companyName).toBeNull();
  });

  it('never reaches another Business through a supplied identity id', async () => {
    const a = migratedBusiness(businessA);
    const b = migratedBusiness(businessB);
    const db = fakeDb({
      identities: [a.identity, b.identity],
      maps: [a.map, b.map],
      profiles: [
        { id: 'profile-a', user_id: businessA, company_name: 'Alpha' },
        { id: 'profile-b', user_id: businessB, company_name: 'Beta' },
      ],
    });

    const resolution = await resolveIdentityById(db, a.identity.id);
    if (resolution.kind !== 'found') throw new Error('expected a resolved identity');
    const projection = await projectLegacyBusinessProfile(db, resolution.identity);

    expect(projection.businessProfileId).toBe('profile-a');
    expect(projection.companyName).not.toBe('Beta');
  });
});

// ===========================================================================
// B5 — one owner, several identities, nothing shared
// ===========================================================================

describe('B5 — one owner may control multiple BCIs without asset mixing', () => {
  it('returns each identity separately and aggregates nothing', async () => {
    const initial = migratedBusiness(businessA);
    const second = { id: '66666666-6666-4666-8666-666666666666', owner_user_id: businessA };
    const db = fakeDb({ identities: [initial.identity, second], maps: [initial.map] });

    const identities = await listIdentitiesControlledBy(db, businessA);

    expect(identities).toHaveLength(2);
    expect(new Set(identities.map((i) => i.id)).size).toBe(2);
    // No combined figure, no shared row, no cross-identity total.
    expect(identities.every((i) => i.ownerUserId === businessA)).toBe(true);
  });

  it('maps only the initial identity to the legacy Business account', async () => {
    const initial = migratedBusiness(businessA);
    const second = {
      id: '66666666-6666-4666-8666-666666666666',
      owner_user_id: businessA,
      origin: 'native',
    };
    const db = fakeDb({ identities: [initial.identity, second], maps: [initial.map] });

    const resolution = await resolveInitialIdentityForBusinessAccount(db, businessA);

    expect(resolution.kind).toBe('found');
    if (resolution.kind !== 'found') return;
    expect(resolution.identity.id).toBe(initial.identity.id);
    expect(resolution.identity.id).not.toBe(second.id);
  });

  it('does not let one owner’s identity resolve another owner’s Business', async () => {
    const a = migratedBusiness(businessA);
    const b = migratedBusiness(businessB);
    const db = fakeDb({ identities: [a.identity, b.identity], maps: [a.map, b.map] });

    const resolution = await resolveInitialIdentityForBusinessAccount(db, businessB);

    expect(resolution.kind).toBe('found');
    if (resolution.kind !== 'found') return;
    expect(resolution.identity.id).toBe(b.identity.id);
    expect(resolution.identity.ownerUserId).toBe(businessB);
  });
});

// ===========================================================================
// Commercial authority — owner only
// ===========================================================================

describe('BCI commercial authority', () => {
  const twoBusinesses = () => {
    const a = migratedBusiness(businessA);
    const b = migratedBusiness(businessB);
    return {
      a,
      b,
      db: fakeDb({ identities: [a.identity, b.identity], maps: [a.map, b.map] }),
    };
  };

  it('grants authority to the canonical controlling Business account', async () => {
    const { a, db } = twoBusinesses();

    const context = await resolveBusinessIdentityContext(db, {
      actorUserId: businessA,
      identityId: a.identity.id,
    });

    expect(context.isCanonicalController).toBe(true);
    expect(context.ownerUserId).toBe(businessA);
    expect(context.legacyBusinessAccountId).toBe(businessA);
    expect(() => requireCommercialAuthority(context)).not.toThrow();
  });

  // Wave 3 grants commercial authority to the ownership relation and to nothing
  // else. Every principal below is refused by the same mechanism: none of them
  // is the owner, and nothing about them is read.
  const denied: Array<[string, string]> = [
    ['an unrelated user', outsider],
    ['an ordinary team member', teamMember],
    ['a member holding manage_team', teamMember],
    ['a member whose role is labelled Admin', teamMember],
    ['a member carrying a reserved permission', teamMember],
    ['a user who merely selected the Business workspace', teamMember],
    ['another Business account', businessB],
  ];

  for (const [who, actorUserId] of denied) {
    it(`denies commercial authority to ${who}`, async () => {
      const { a, db } = twoBusinesses();

      await expect(
        resolveBusinessIdentityContext(db, { actorUserId, identityId: a.identity.id }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'BCI_COMMERCIAL_AUTHORITY_REQUIRED' });
    });
  }

  it('denies a platform administrator the controller role', async () => {
    const { a, db } = twoBusinesses();
    const admin = '77777777-7777-4777-8777-777777777777';

    await expect(
      resolveBusinessIdentityContext(db, { actorUserId: admin, identityId: a.identity.id }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'BCI_COMMERCIAL_AUTHORITY_REQUIRED' });
  });

  it('refuses an unknown identity with the same answer as one it does not control', async () => {
    const { db } = twoBusinesses();

    await expect(
      resolveBusinessIdentityContext(db, {
        actorUserId: businessA,
        identityId: '88888888-8888-4888-8888-888888888888',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'BCI_COMMERCIAL_AUTHORITY_REQUIRED' });
  });

  it('fails closed for the controller when the mapping is corrupt', async () => {
    const identityId = deterministicInitialIdentityId(businessA);
    const db = fakeDb({
      identities: [{ id: identityId, owner_user_id: businessA }],
      maps: [],
    });

    await expect(
      resolveBusinessIdentityContext(db, { actorUserId: businessA, identityId }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'BCI_MAPPING_AMBIGUOUS' });
  });

  it('does not disclose corruption to anyone but the named owner', async () => {
    const identityId = deterministicInitialIdentityId(businessA);
    const db = fakeDb({
      identities: [{ id: identityId, owner_user_id: businessA }],
      maps: [],
    });

    await expect(
      resolveBusinessIdentityContext(db, { actorUserId: outsider, identityId }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'BCI_COMMERCIAL_AUTHORITY_REQUIRED' });
  });

  it('denies authority to a controller whose identity is not active', async () => {
    const a = migratedBusiness(businessA);
    const db = fakeDb({
      identities: [{ ...a.identity, status: 'archived' }],
      maps: [a.map],
    });

    const context = await resolveBusinessIdentityContext(db, {
      actorUserId: businessA,
      identityId: a.identity.id,
    });

    expect(() => requireCommercialAuthority(context)).toThrowError(
      expect.objectContaining({ code: 'BCI_NOT_ACTIVE' }),
    );
  });

  it('gives an account that is not a legacy Business no initial identity, and no error', async () => {
    const { db } = twoBusinesses();

    await expect(resolveOwnInitialBusinessIdentity(db, outsider)).resolves.toBeNull();
  });

  it('resolves an owner to their own initial identity without an identifier', async () => {
    const { a, db } = twoBusinesses();

    const context = await resolveOwnInitialBusinessIdentity(db, businessA);

    expect(context?.identityId).toBe(a.identity.id);
    expect(context?.isCanonicalController).toBe(true);
  });
});

// ===========================================================================
// The Wave 4 boundary, asserted where it actually holds
// ===========================================================================

describe('the commercial authority boundary is structural', () => {
  const authorization = () =>
    codeOf('../modules/business-identity/business-identity.authorization.ts');
  const repository = () => codeOf('../modules/business-identity/business-identity.repository.ts');

  it('never consults team membership, roles, invitations or workspace selection', () => {
    // The denials above pass because these terms do not appear. Asserting the
    // absence is what stops a future edit from adding a membership join and
    // turning every one of those tests into a fixture detail.
    for (const source of [authorization(), repository()]) {
      expect(source).not.toContain('business_members');
      expect(source).not.toContain('business_team_roles');
      expect(source).not.toContain('business_team_invites');
      expect(source).not.toContain('business_teams');
      expect(source).not.toContain('selectedWorkspace');
    }
  });

  it('reads no reserved team permission', () => {
    for (const source of [authorization(), repository()]) {
      for (const reserved of [
        'manage_team',
        'manage_services',
        'manage_jobs',
        'manage_reservations',
        'view_wallet',
        'manage_support_disputes',
        'view_analytics',
      ]) {
        expect(source).not.toContain(`'${reserved}'`);
      }
    }
  });

  it('offers no administrative bypass', () => {
    const source = authorization();

    expect(source).not.toContain('isAdmin');
    expect(source).not.toContain('is_admin');
    expect(source).not.toContain('hasAdminPermission');
    // Authority is the ownership comparison, and there is one of it.
    expect(source).toContain('identity.ownerUserId !== params.actorUserId');
  });

  it('resolves authority from the ownership column alone', () => {
    const source = repository();

    expect(source).toContain('owner_user_id');
    // No unordered LIMIT 1: a set that should hold one row is checked, not
    // truncated.
    expect(source).not.toMatch(/LIMIT\s+1/i);
  });
});
