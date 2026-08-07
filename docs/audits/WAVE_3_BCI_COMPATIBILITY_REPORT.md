# Wave 3 BCI Compatibility Report

**Slice:** Wave 3 slice 1 — additive Business Commercial Identity compatibility.
**Date:** 2026-08-06.
**Worktree:** `D:\Private Projects\MohandisHub-wave3-final`.
**Branch:** `codex/wave3-bci-compatibility` (continued; not renamed, no duplicate branch created).

---

## 1. Verdict

**BCI SLICE COMPLETE WITH NON-BLOCKING RISKS — READY FOR MERGE REVIEW.**

_Updated 2026-08-06 after PostgreSQL execution (§17), and 2026-08-07 after the B5 compatibility
correction found in independent review (§18)._

The additive spine, the deterministic backfill, the constraint set, the domain layer, the
authorization boundary and B1–B5 are implemented, committed and **executed against a real
PostgreSQL server**. All 104 migrations replay from an empty database, migration 104 applies and
reconciles, and all 23 BCI PostgreSQL tests pass. **No change to the migration was required, at
any point.**

One merge blocker was found in independent review and is now closed: the legacy compatibility
projection resolved the Business profile from the identity's owner rather than from the
authoritative legacy map, so a second, natively created BCI controlled by the same account could
reach the legacy Business's profile. That is a B5 isolation failure. It is fixed in the domain
layer, and the fix is protected by eight behavioural regression tests — verified to fail when
the correction is reverted. **§18 records it in full; the B5 row in §3 and the isolation claim
in §10 have been corrected rather than left standing.**

Two non-blocking risks remain, neither in this slice: two pre-existing schema-fingerprint tests
in unrelated suites fail on PostgreSQL 18 for a reason proven independent of migration 104, and
the database validation ran on PostgreSQL 18.4 rather than the PostgreSQL 17 the committed
Supabase configuration targets. See §14.

---

## 2. Base and Branch

| Item               | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| Base commit        | `0c804c6149d9d910bfdd17bb4abc177361bb49c9` (= `main`, `origin/main`)      |
| Branch             | `codex/wave3-bci-compatibility`                                           |
| Upstream           | `origin/codex/wave3-bci-compatibility`                                    |
| Start-of-work HEAD | `0c804c6149d9d910bfdd17bb4abc177361bb49c9`, clean tree, no diff from main |
| Migrations before  | 103                                                                       |
| Migrations after   | 104                                                                       |
| Files changed      | 7 (6 added, 1 modified)                                                   |

All six pre-flight verification checks matched their expected values before any work began.

---

## 3. B1–B5 Implementation Matrix

Wording taken verbatim from `docs/architecture/wave-3/16-wave-3-scope.md` §1.12 B.

| #      | Requirement                                                                                                                      | Implementation                                                                                                                                                                                                                                                                                                                                                     | Tests                                                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | A legacy Business account maps to **exactly one** initial BCI, deterministically; re-running creates none                        | `business_commercial_identity_deterministic_id()`; `PRIMARY KEY (business_account_id)`; `UNIQUE (bci_id)`; `CHECK (bci_id = deterministic(business_account_id))`; backfill with `ON CONFLICT … DO NOTHING` on both inserts                                                                                                                                         | `B1 — a legacy Business account maps to exactly one initial BCI` (6 tests) + pg `deterministic backfill` / `idempotency and concurrency` (9)                                                    |
| **B2** | **Team/workspace IDs remain unchanged** across the migration                                                                     | The migration issues no `INSERT`/`UPDATE`/`DELETE`/`ALTER` against `business_teams`; the table is read only by the preflight                                                                                                                                                                                                                                       | `renumbers no workspace…`, `writes only to the two tables it creates`; pg `leaves team IDs, members, roles, invitations and profiles byte-identical`                                            |
| **B3** | **Memberships, invitations, roles and audit history remain unchanged**, including roles carrying a reserved permission           | Same: `business_members`, `business_team_roles`, `business_team_invites`, `business_team_audit_log` are never written                                                                                                                                                                                                                                              | `renumbers no workspace…`; pg `…byte-identical` (seeds a role carrying `manage_jobs` + `view_analytics`) and `preserves a reserved permission on the role that carries it`                      |
| **B4** | **User-owned historical assets remain readable** throughout the compatibility period                                             | No asset is re-keyed, no owner column is added, no BCI column is made mandatory anywhere. `business_profiles.user_id` remains the profile owner and the legacy read path is untouched                                                                                                                                                                              | `adds no owner column to any existing commercial asset`; pg `leaves every existing commercial asset ownership column untouched`; projection tests prove the same profile row resolves both ways |
| **B5** | **One owner may control multiple BCIs without asset mixing** — assets, balance, reputation and enforcement stay separate per BCI | `owner_user_id` is indexed but deliberately **not** unique; only the _initial_ identity is mapped, so a second identity the same owner controls has no legacy anchor and no shared row. No aggregate is computed anywhere. **The compatibility projection resolves through the authoritative legacy map, never through ownership — corrected 2026-08-07, see §18** | `B5 — one owner may control multiple BCIs without asset mixing` (3 tests) + the no-asset-mixing group + the legacy-anchor group (8 tests, §18)                                                  |

---

## 4. Data Model

Two new tables, both additive.

### `business_commercial_identities`

| Column          | Notes                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- |
| `id`            | `UUID PRIMARY KEY` — deterministic for legacy-origin identities                        |
| `owner_user_id` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE`. The single authoritative controller |
| `status`        | `active` / `suspended` / `archived`                                                    |
| `origin`        | `legacy_business_account` / `native` — keeps the two populations distinguishable       |
| `created_at`    | audit                                                                                  |
| `updated_at`    | audit                                                                                  |

Constraints and objects:

- `chk_business_commercial_identities_legacy_id_deterministic` — an identity claiming legacy
  origin must carry the deterministic id for its owner. A native identity cannot be passed off
  as somebody's initial BCI.
- `uq_business_commercial_identities_id_owner UNIQUE (id, owner_user_id)` — the target of the
  mapping's composite foreign key.
- `idx_business_commercial_identities_owner`.
- `trg_business_commercial_identities_immutable_owner` — ownership transfer is not an `UPDATE`.
  Mirrors the immutability already enforced on `business_teams.business_id`.

**There is deliberately no second ownership source** — no controller table, no membership join,
no workspace column. A second source is a second answer.

### `business_commercial_identity_legacy_map`

| Column                 | Notes                                                     |
| ---------------------- | --------------------------------------------------------- |
| `business_account_id`  | `UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` |
| `bci_id`               | `NOT NULL`, `UNIQUE`                                      |
| `created_by_migration` | provenance; never projected through an API                |
| `created_at`           | audit                                                     |

Constraints:

- `PRIMARY KEY (business_account_id)` — one legacy Business principal, at most one initial BCI.
- `uq_business_commercial_identity_legacy_map_bci UNIQUE (bci_id)` — one initial BCI, at most
  one legacy Business principal. Two Businesses can never be combined.
- `chk_business_commercial_identity_legacy_map_deterministic` — the mapping must point at _the_
  deterministic identity for that account. There is no arbitrary row to select.
- `fk_business_commercial_identity_legacy_map_identity FOREIGN KEY (bci_id, business_account_id)
REFERENCES business_commercial_identities (id, owner_user_id)` — owner mismatch is not a state
  the database can hold.

Both tables take the existing backend-only posture: `ENABLE ROW LEVEL SECURITY` plus
`REVOKE ALL … FROM anon, authenticated`. No existing policy was altered, dropped or weakened.

---

## 5. Deterministic Legacy Backfill

**Rule.** The initial BCI id is a pure function of the legacy Business account id:

```
uuid_v3( md5( 'mohandishub:wave3:business-commercial-identity:initial:' || <users.id> ) )
```

with the version nibble forced to `3` and the variant nibble to `10xx`, so the result is a
well-formed RFC 4122 identifier that satisfies the UUID validators already present in the
request path — not merely PostgreSQL's parser.

`md5()` is core PostgreSQL. pgcrypto's `digest()` was rejected because the extension is not
guaranteed to sit on the search path of every deployment this schema is replayed into. The hash
is a name derivation over a primary key the database already holds, not a security primitive.

**Population.** Every `users` row with `primary_role = 'business'`. Deactivated accounts are
included deliberately: a BCI is a commercial identity with its own lifecycle column,
`users.is_active` is a login fact, and conflating them would leave a reactivated Business
without the identity its assets are meant to hang off. Because the id is deterministic, minting
it now and minting it later produce the same row either way.

The rule is implemented twice — in SQL and in `business-identity.constants.ts` — and a test
asserts the namespace string and the nibble rewriting against the migration's own text, so the
two cannot silently diverge.

---

## 6. Idempotency and Concurrency

Convergence is **structural, not procedural**. There is no "have I done this already?" query.

- The deterministic id **is** the primary key, so a second run's insert collides and
  `ON CONFLICT (id) DO NOTHING` absorbs it.
- The mapping insert collides on `PRIMARY KEY (business_account_id)` and is absorbed the same
  way.
- Ten concurrent transactions running the same two statements therefore settle on exactly one
  identity and one mapping — the second inserter blocks on the first's uncommitted key and then
  finds the conflict, rather than racing a `SELECT` that returned nothing.
- The DDL is guarded with `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS`, so
  re-applying the file is safe end to end.
- A complete reversal is documented in the migration header and exercised by a test that
  re-applies afterwards and gets the identical identifiers back.

---

## 7. Ambiguous Data Handling

Two legacy states cannot be resolved by inference, and the migration **aborts before writing
anything** rather than guessing — the same posture `20260731120000` took.

1. **A workspace owned by an account whose `primary_role` is not `business`.** Migration
   `20260731120000` made this unreachable going forward but never validated existing rows. The
   workspace, its roles, its invitations and its asset keying all say a Business operates here;
   the account says it is not one. Minting a BCI would create a commercial identity for a
   non-Business account; skipping it would leave an operating workspace outside the spine.
   Neither is inferable, so neither is chosen.
2. **An account owning more than one workspace.** Already impossible via
   `uq_business_teams_business_id`; asserted so the premise the mapping rests on is checked
   rather than assumed.

Because DDL in PostgreSQL is transactional, an abort leaves the database exactly as it was —
the pg suite asserts the tables do not exist afterwards.

**At runtime**, the repository reports four named ambiguities rather than returning a row:
`multiple_identities_resolved`, `duplicate_legacy_mappings`, `owner_mismatch` and
`orphan_initial_identity`. Each is distinct from `not_found`. There is no `rows[0]` and no
unordered `LIMIT 1` anywhere in the module.

**Reconciliation** runs inside the migration, before commit, and raises on any of: count
mismatch between legacy Businesses / initial BCIs / mappings, an unmapped Business, an orphan
initial BCI, an owner mismatch, a non-deterministic mapping, a Business with two initial BCIs,
and a BCI mapped to two Businesses.

---

## 8. Authorization Model

One question — _is this actor the canonical controller of this BCI?_ — with exactly one
affirmative answer in Wave 3: the account named in
`business_commercial_identities.owner_user_id`.

Denied, each with a test:

| Principal                                       | Result |
| ----------------------------------------------- | ------ |
| Unrelated user                                  | 403    |
| Ordinary Business team member                   | 403    |
| Member holding `manage_team`                    | 403    |
| Member whose role is labelled Admin (`manager`) | 403    |
| Member carrying a reserved permission           | 403    |
| User who merely selected the Business workspace | 403    |
| Another Business account                        | 403    |
| Platform administrator                          | 403    |

**The mechanism is that none of them is consulted.** `business_members`,
`business_team_roles`, `business_team_invites`, `business_teams` and workspace-selection state
do not appear in `business-identity.authorization.ts` or `business-identity.repository.ts`, and
a test asserts their absence from the source with comments stripped. A reserved permission
cannot be wired to a decision that never reads it — that is what makes the Wave 4 boundary
structural rather than remembered.

There is **no administrative bypass** and no parameter through which one could be added; the
test asserts `isAdmin`, `is_admin` and `hasAdminPermission` are absent. Administrative
inspection continues through the existing admin surfaces, unchanged.

An unknown identity and one the actor does not control produce the **same** 403, so the resolver
is not an existence oracle. A corrupt mapping fails closed with a 409 — but only to the account
the corrupt row names as owner; to everyone else it is the ordinary 403. `requireCommercialAuthority`
additionally requires `status = 'active'`, deliberately conservative.

**No Business route was converted.** This slice introduces and proves the compatibility
boundary only.

---

## 9. Legacy Compatibility

- `business_teams`, `business_members`, `business_team_roles`, `business_team_invites`,
  `business_team_audit_log` and `business_profiles` are never written by the migration. A pg
  test compares a full JSON snapshot of all five before and after and requires byte equality,
  with a role deliberately carrying `manage_jobs` and `view_analytics`.
- The immutable `business_teams.business_id` → `users.id` relation remains the compatibility
  anchor for the duration of the migration, exactly as `09 §4.4` requires.
- No commercial asset acquired an owner column, and no BCI column is mandatory anywhere; a pg
  test asserts the shape of every `user_id` / `provider_id` / `business_id` / `owner_id` column
  in the public schema is unchanged, and that no table outside the map gained a `bci_id`.
- Existing legacy Business profile reads run through the untouched profiles module. The full
  existing API suite (601 tests) passes unchanged.

---

## 10. No-Asset-Mixing Guarantees

| Guarantee                                            | How                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business A's BCI never resolves Business B's profile | The projection resolves the authoritative legacy map for the supplied BCI and reads `business_profiles` by the account that map names. **Corrected 2026-08-07** — it previously read by `identity.ownerUserId`, which also let a same-owner native BCI reach the legacy profile (§18) |
| Business A's team cannot attach to Business B's BCI  | The BCI schema has no team column at all, and the migration writes nothing to any team table                                                                                                                                                                                          |
| A malformed mapping never picks a random BCI         | `CHECK (bci_id = deterministic(business_account_id))` in the database; named ambiguity instead of `rows[0]` in the repository                                                                                                                                                         |
| No cross-BCI aggregation exists                      | `listIdentitiesControlledBy` returns rows; nothing sums, averages or joins across identities                                                                                                                                                                                          |
| No existing commercial asset is reassigned           | Zero writes outside the two new tables, asserted by parsing the migration's own statements                                                                                                                                                                                            |
| Two Businesses cannot share one identity             | `UNIQUE (bci_id)` on the map, plus the composite foreign key                                                                                                                                                                                                                          |

---

## 11. Files and Migration Added

**Migration (1, new — no existing migration edited):**

- `supabase/migrations/20260806090000_business_commercial_identity_compatibility.sql`

**Domain layer (3, new):**

- `apps/api/src/modules/business-identity/business-identity.constants.ts`
- `apps/api/src/modules/business-identity/business-identity.repository.ts`
- `apps/api/src/modules/business-identity/business-identity.authorization.ts`

**Tests (2, new):**

- `apps/api/src/tests/business-identity.compatibility.test.ts`
- `apps/api/src/tests/business-identity.migration.pg.test.ts`

**Test baseline (1, modified):**

- `apps/api/src/tests/public-upload-deletion.service.test.ts` — Phase 0, see §12.

---

## 12. Tests

**Phase 0 — CRLF baseline.** Reproduced. `public-upload-deletion.service.test.ts` asserts
`upload.routes.ts` source text verbatim including an embedded `\n`; on this checkout
`* text=auto` plus `core.autocrlf=true` materializes that file with CRLF, so the assertion
failed while the protected behaviour was intact. `readSource` now normalizes CRLF to LF. The
assertion itself is unchanged, and mutating the route away from the trusted `/public/:id`
object-id form still fails the test — verified by mutating the source, re-running, and
restoring. Committed in isolation.

| Suite                                     | Tests                                            |
| ----------------------------------------- | ------------------------------------------------ |
| `business-identity.compatibility.test.ts` | 46 passing (no database required)                |
| `business-identity.migration.pg.test.ts`  | **23 passing** against PostgreSQL 18.4 — see §17 |

**Ordinary counts:**

| Point                           | Passing          |
| ------------------------------- | ---------------- |
| Before Phase 0                  | 894 (+1 failing) |
| After Phase 0 (target baseline) | **895**          |
| After the BCI slice             | **941**          |

941 = 20 (shared) + 601 (api) + 320 (web). The delta is exactly the 46 new compatibility tests.

**PostgreSQL-gated tests: 332** — 309 pre-existing plus the 23 added by this slice. They skip in
an ordinary run and were executed in full during the §17 validation.

---

## 13. Validation

| Check                       | Result                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                  | **PASS** — 941 passing, 331 skipped                                                                                                                                                                      |
| `npm run typecheck`         | **PASS**                                                                                                                                                                                                 |
| `npm run lint`              | **PASS** — `--max-warnings=0`, api and web                                                                                                                                                               |
| `npm run validate:i18n`     | **PASS**                                                                                                                                                                                                 |
| `npm run build`             | **PASS**                                                                                                                                                                                                 |
| Prettier on changed files   | **PASS** (`.sql` has no Prettier parser and is not covered)                                                                                                                                              |
| `git diff --check`          | **PASS** — no whitespace errors                                                                                                                                                                          |
| Migration static validation | superseded by the live replay in §17. `scripts/migration-dryrun.mjs` and `scripts/migration-replay-check.mjs` both target an existing `DATABASE_URL` deployment and were deliberately not pointed at one |

---

## 14. Known Risks

1. ~~**The migration has not been executed against a real PostgreSQL server.**~~ **Closed
   2026-08-06** — all 104 migrations replay from empty, migration 104 applies and reconciles,
   and all 23 BCI PostgreSQL tests pass. See §17.
2. **Validation ran on PostgreSQL 18.4, not the deployment's major version.** The disposable
   cluster was whatever the workstation had. Nothing migration 104 uses is version-sensitive
   (`md5`, `overlay`, `position`, `substr`, `format`, plpgsql `DO` blocks, composite foreign
   keys, a CHECK calling an `IMMUTABLE` function), and PostgreSQL 18 is the _stricter_ direction
   for this schema. It is still a different major version from Supabase's.
   **Mitigation:** re-run the gated suite once against the deployment's major version.
3. **Two pre-existing schema-fingerprint tests fail on PostgreSQL 18, for a reason proven
   unrelated to this slice.** `advertisements.weekly-billing.pg.test.ts` and
   `business-teams.workspace.pg.test.ts` each roll a migration back and assert nothing foreign
   disappeared. PostgreSQL 18 materializes `NOT NULL` constraints as `pg_constraint` rows
   (`contype = 'n'`), which PostgreSQL ≤ 17 does not, so dropping a column now also removes a
   constraint row those allowlists were never written to expect. Reproduced on a database built
   from migrations 1–103 with migration 104 **absent entirely**, yielding the identical key and
   **zero** removed keys naming a BCI object. Classified: **previously legal data now visible
   through a changed catalog representation** — a test/PostgreSQL-version incompatibility, not
   corrupt data and not an architecture contradiction. Left unchanged: they are unrelated
   suites, out of scope for this slice, and they do not fail on the deployment's version.
4. **A CHECK constraint calls a user-defined function.** Supported and `IMMUTABLE`, but it makes
   `pg_dump` restore order matter — the function must exist before the table. Within this
   migration it does, and a clean replay builds them in order.
5. **The preflight can block a deployment.** If production holds a workspace whose owning account
   has drifted out of the `business` primary role, the migration aborts by design. That is the
   fail-closed posture the architecture requires, and the error message names the repair. The
   `20260731120000` header records that production held none of the equivalent states. Verified
   live: the abort leaves the two BCI tables non-existent.
6. **`ON DELETE CASCADE` on `owner_user_id`.** Deleting a Business account removes its BCI. This
   matches the existing `business_teams.business_id` behaviour and is harmless while no
   commercial asset hangs off a BCI, but it must be revisited when assets are re-associated.

---

## 15. Explicitly Deferred Scope

Nothing below was implemented, and no scaffolding for any of it was added:

PCI · PCI conversion · MHC carryover · Engagements · Offers · Proposals · Orders · settlement ·
fulfillment · verified GMV · rent charging · Jobs redesign · Jobs monetization · service
ownership migration · advertisement ownership migration · plan ownership migration · wallet
ownership migration · delegated commercial authority · ownership transfer · workspace-owned
commercial assets · BCI switcher · BCI creation UI · BCI management UI · cross-BCI analytics ·
branches or sub-organizations.

Confirmed by inspection of the branch diff against `0c804c6`: no frontend file was touched, no
public route was added, and a test parses the migration for the terms `engagement`,
`settlement`, `personal_commercial`, `fulfillment_component`, `proposal`,
`mhc_job_activations` and `verified_gmv` and requires their absence.

---

## 16. Recommended Next Wave 3 Slice

**Additive advertisement ownership re-association onto the BCI/PCI spine**
(`00 §14.1`, `09 §4.4`, scope §1.1c).

It is the right next slice because:

- it is the smallest piece of work that **exercises** the spine this slice built, turning the
  BCI from a principal nothing points at into one that owns something;
- the architecture already fixes its terms — additive owner column, no destructive re-keying,
  existing campaigns, periods and renewal state readable throughout — so it opens no product
  question;
- the advertisement machinery is already implemented, wired and priced at zero, so the slice is
  a re-association with idempotency guarantees rather than new commercial behaviour;
- it forces the compatibility dual-read pattern (`user-owned` and `identity-owned` readable
  side by side) to be built once, correctly, on a low-risk asset — before the same pattern has
  to carry settlement.

It should **not** enable non-zero advertisement pricing, which stays a separate explicit
configuration and commercial-approval decision.

If a spine-hardening slice is preferred first, the alternative is **converting the Business
commercial routes to `resolveBusinessIdentityContext`**, which has no data migration at all and
would retire the last places where `req.user.id` doubles as the commercial principal.

---

## 17. PostgreSQL Execution Validation — 2026-08-06

Added after the implementation report above. This section records the live execution of
migration 104 and the PostgreSQL-gated suites. **No change to the migration was required.**

### 17.1 Scratch environment

| Item                    | Value                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Method                  | A brand-new PostgreSQL cluster created with `initdb` for this task alone           |
| Server                  | PostgreSQL 18.4 (workstation `scoop` install of the client/server binaries)        |
| Data directory          | The session scratchpad, outside the repository                                     |
| Listen address          | `127.0.0.1` only, port `55432` (non-default)                                       |
| Contents at creation    | `postgres`, `template0`, `template1` — **no user database, no user data**          |
| Disposability           | The cluster did not exist before this task; teardown is stop + delete the data dir |
| Scratch database prefix | `mohandishub_wave3_bci_test_`, plus the harness's own `mhc_it_*`                   |

**Nothing pre-existing was touched.** The workstation's persisted cluster
(`scoop/persist/postgresql/data`) was never started and never connected to; no server was
listening on 5432 or 54322 at any point. No `DATABASE_URL` existed in the environment or in the
repository, none was invented, and no credential was written to a repository file or a commit.
`PG_INTEGRATION_URL` was supplied per-command for the duration of a single shell invocation.

**Environment prerequisite discovered.** A vanilla PostgreSQL cluster does not carry Supabase's
cluster roles, so the replay first failed at migration 76
(`20260610132000_backend_only_rls_storage_indexes.sql`) with `role "anon" does not exist`
(SQLSTATE `42704`). This is a property of the empty cluster, not of any migration: 19 migrations
reference `anon` and `authenticated`. Creating `anon`, `authenticated`, `service_role` and
`authenticator` as cluster roles resolved it. Worth recording for anyone replaying this schema
outside Supabase.

### 17.2 Full migration replay

| Check                                     | Result                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| All 104 migrations from an empty database | **PASS** — applied in repository order, zero failures                                                            |
| Migration 104 execution                   | **PASS**                                                                                                         |
| Reconciliation block                      | **PASS** — emitted `BCI compatibility: 0 legacy Business account(s) reconciled to 0 initial BCI(s), one to one.` |
| Existing migration files modified         | **None** — the diff against the base touches no file under `supabase/migrations/` other than the new 104         |

Objects created by migration 104, read back from the catalog:

- **Tables:** `business_commercial_identities`, `business_commercial_identity_legacy_map` — both
  with `relrowsecurity = true`.
- **Keys:** `business_commercial_identities_pkey (id)`;
  `uq_business_commercial_identities_id_owner UNIQUE (id, owner_user_id)`;
  `business_commercial_identity_legacy_map_pkey (business_account_id)`;
  `uq_business_commercial_identity_legacy_map_bci UNIQUE (bci_id)`.
- **Foreign keys:** `owner_user_id → users(id) ON DELETE CASCADE`;
  `business_account_id → users(id) ON DELETE CASCADE`; and the composite
  `(bci_id, business_account_id) → business_commercial_identities(id, owner_user_id) ON DELETE CASCADE`.
- **CHECKs:** `chk_business_commercial_identities_legacy_id_deterministic`;
  `chk_business_commercial_identity_legacy_map_deterministic`; status and origin enums.
- **Index:** `idx_business_commercial_identities_owner`.
- **Trigger:** `trg_business_commercial_identities_immutable_owner`.
- **Functions:** `business_commercial_identity_deterministic_id` — reported `provolatile = i`
  (IMMUTABLE), `proparallel = s` (PARALLEL SAFE), `proisstrict = true`; and
  `business_commercial_identities_reject_owner_change`.

### 17.3 PostgreSQL-gated test results

Command: `RUN_PG_INTEGRATION=1 PG_INTEGRATION_URL=… npx vitest run` in `apps/api`.

| Population                             | Passed  | Failed | Notes                                        |
| -------------------------------------- | ------- | ------ | -------------------------------------------- |
| **New BCI PostgreSQL tests**           | **23**  | **0**  | `business-identity.migration.pg.test.ts`     |
| Pre-existing PostgreSQL-gated tests    | 307     | 2      | both PostgreSQL 18 artifacts, see §14.3      |
| Whole `@mohandishub/api` suite (gated) | **931** | 2      | 933 total, duration ≈ 30 s wall / 222 s test |

The 23 BCI tests are one more than the 22 originally written: the SQL↔TypeScript determinism
check was strengthened during this validation to pin five fixed UUIDs spanning the variant
nibble's range, and a test was added for an account that becomes a Business after the first run.

**Two harness defects were found and fixed in the new pg test file. Neither was a migration
defect, and the migration was not touched:**

1. Seventeen tests failed with
   `business workspace … must have exactly one owner at commit (found 0)`. The fixture inserted
   the workspace, its role and its owner membership as three autocommitted statements, so the
   deferred constraint trigger `trg_business_teams_owner_present` from `20260731120000`
   correctly refused an ownerless committed workspace. **The database was right and the fixture
   was wrong**; workspace provisioning is now transactional, as the real provisioning path is.
   Incidental live confirmation that migration 103's lower owner bound works.
2. One test asserted that no table matching `%proposal%` (among other patterns) exists, which
   matched the pre-existing `reservation_location_proposals`. Replaced with a before/after
   table-set diff asserting the migration's entire footprint is exactly the two BCI tables and
   that no table disappeared — strictly stronger than the pattern it replaced.

### 17.4 Deterministic backfill

Verified live, all passing:

| Case                                                        | Result                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| Zero Business accounts → zero BCIs                          | PASS (reconciliation NOTICE reported 0 → 0)            |
| One Business → exactly one initial BCI                      | PASS, id equals the deterministic value                |
| Several Businesses → isolated, distinct identities          | PASS, 3 accounts → 3 distinct BCIs                     |
| Deactivated Business account included (documented decision) | PASS                                                   |
| Non-Business accounts receive no BCI                        | PASS (`customer`, `expert`)                            |
| Account promoted to Business after the first run            | PASS — no BCI until re-run, then the deterministic one |
| SQL and TypeScript agree on fixed UUIDs                     | PASS for all five, each matching `…-3xxx-[89ab]xxx-…`  |
| Owner on the BCI matches the legacy Business account        | PASS                                                   |
| Legacy map and BCI records agree                            | PASS (owner mismatch count 0 in every state exercised) |

### 17.5 Idempotency

Re-applying the whole migration file leaves the identity id, the mapping, the row counts and the
`created_at` timestamp unchanged; the DDL re-applies without duplicate triggers, indexes or
constraints. A full reversal followed by a re-application produces the **identical** BCI
identifier — which is the practical meaning of determinism. All passing.

### 17.6 Concurrency

Ten concurrent transactions each running both backfill statements against the same Business
settled on **one** identity and **one** mapping, with no owner mismatch, no deadlock, and no
uniqueness violation surfacing as a partial success. Separate Businesses stayed fully isolated.
Executed against the real server rather than inferred from `ON CONFLICT`.

### 17.7 Preflight, rejection and rollback

The preflight abort was exercised live: a workspace whose owning account had drifted out of the
`business` primary role caused the migration to raise `Refusing to migrate: …`, and afterwards
`to_regclass('public.business_commercial_identities')` was **NULL** — DDL is transactional, so
the abort left no partial BCI state and no mutated legacy row.

Every conflicting write was refused by the database, with the data intact afterwards
(`identities=2 mappings=2 owner_mismatches=0`):

| Attempt                                       | SQLSTATE | Refused by                          |
| --------------------------------------------- | -------- | ----------------------------------- |
| Map a Business to a non-deterministic BCI     | 23514    | deterministic CHECK                 |
| Two Businesses sharing one BCI                | 23514    | deterministic CHECK (before UNIQUE) |
| A second mapping for one Business             | 23505    | mapping primary key                 |
| Repoint a mapping to another account          | 23514    | deterministic CHECK                 |
| Mutate a BCI's owner                          | 23514    | immutable-owner trigger             |
| Legacy-origin BCI with a non-deterministic id | 23514    | legacy-id CHECK                     |
| Invalid `status`                              | 23514    | status CHECK                        |
| Map to a BCI that does not exist              | 23503    | composite foreign key               |

### 17.8 RLS and privileges

Tested with `SET ROLE` on a live connection, not by reading the migration:

| Role            | Operation                                     | Result                             |
| --------------- | --------------------------------------------- | ---------------------------------- |
| `authenticated` | `SELECT` either table                         | refused, `42501` permission denied |
| `authenticated` | `INSERT` an identity with arbitrary ownership | refused, `42501`                   |
| `authenticated` | `UPDATE owner_user_id`                        | refused, `42501`                   |
| `authenticated` | `INSERT` a mapping claiming another Business  | refused, `42501`                   |
| `authenticated` | `DELETE` mappings                             | refused, `42501`                   |
| `anon`          | `SELECT` identities                           | refused, `42501`                   |

Both tables report `relrowsecurity = true`, and `information_schema.role_table_grants` returns
**no rows** for `anon` or `authenticated`. This is the repository's existing backend-only
posture: the API connects with the service role, and browser-facing roles reach these tables
through no path at all. No policy was disabled to test this.

### 17.9 Legacy compatibility

A JSON snapshot of `business_teams`, `business_members`, `business_team_roles`,
`business_team_invites` and `business_profiles` — taken with a seeded workspace, a pending
invitation and a role deliberately carrying the reserved `manage_jobs` and `view_analytics`
permissions — is **byte-identical** before and after migration 104. The reserved permission
survives on its role. The shape of every `user_id` / `provider_id` / `business_id` / `owner_id`
column in the public schema is unchanged, no table outside the mapping gained a `bci_id` or
`commercial_identity_id` column, and the migration's entire table footprint is exactly the two
BCI tables with nothing removed.

### 17.10 Cleanup

| Step                                     | Result                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Scratch databases dropped                | Done — `mohandishub_wave3_bci_test_*` and the harness's `mhc_it_*` |
| Cluster left holding only defaults       | Verified — `postgres`, `template0`, `template1`                    |
| Throwaway cluster stopped                | Done (`pg_ctl -m fast stop`), port 55432 no longer listening       |
| Throwaway data directory deleted         | Done                                                               |
| Any other database touched               | **None**                                                           |
| Credentials, dumps or `.env` in the repo | **None** — the only working-tree change is the pg test file        |

### 17.11 Files changed by this validation

- `apps/api/src/tests/business-identity.migration.pg.test.ts` — transactional workspace fixture,
  footprint-diff assertion, fixed-UUID determinism check, promoted-account test.

The migration, the domain layer and the ordinary test suite were **not** modified. Ordinary
counts are unchanged at **941 passing**; `typecheck`, `lint`, `validate:i18n`, `build`,
changed-file Prettier and `git diff --check` all pass.

---

## 18. B5 Compatibility Correction — 2026-08-07

Independent review found one merge-blocking defect in this slice. It is recorded here in full,
including the claims elsewhere in this report that it invalidated.

### 18.1 The defect

`projectLegacyBusinessProfile` in
`apps/api/src/modules/business-identity/business-identity.repository.ts` resolved the legacy
Business profile like this:

```
projectLegacyBusinessProfile(db, identity)
  → SELECT id, company_name FROM business_profiles WHERE user_id = identity.ownerUserId
```

The authoritative mapping table was never consulted. The function also reported
`businessAccountId: identity.ownerUserId`, presenting the controller as though it were the
legacy Business anchor.

### 18.2 Why owner-only lookup violates BCI isolation

`owner_user_id` answers _who controls this identity_. The legacy map answers _which legacy
Business this identity is the initial BCI of_. For an initial BCI the two coincide, which is
exactly why the defect passed every test written against a single migrated Business — and they
are still different facts.

The model permits one account to control several BCIs, of which **exactly one** is its legacy
Business's initial identity ([09 §4.4](../architecture/wave-3/09-business-buying-and-providing.md),
scope §1.12 B5). A second, natively created BCI shares the owner and has no legacy anchor at
all. Under owner-only lookup it projected the same legacy Business profile — two commercial
identities reading one Business's compatibility state, which is precisely the asset mixing B5
forbids. The blast radius grows with the next slice: once assets are re-associated onto the
spine, an identity that can reach a Business's legacy profile is an identity that can reach its
legacy assets.

This was a defect in the **domain layer only**. The schema was already correct: only the initial
BCI is mapped, and the map's primary key, unique key, deterministic CHECK and composite foreign
key all held. The repository simply was not reading them.

### 18.3 The authoritative legacy-anchor rule

Legacy compatibility now flows through the persisted mapping and through nothing else. The
function takes an **identity id** rather than an identity object, so the anchor cannot be
supplied by the caller, and it resolves the identity through the same validated path every other
read uses. Four conditions must hold before a single profile column is read:

1. the identity resolves cleanly — `resolveIdentityById` has already rejected duplicate mappings
   and orphaned initial identities;
2. it carries an authoritative mapping row at all;
3. that row names the identity's own owner;
4. the mapped identity is the deterministic identity for that account, and declares
   `legacy_business_account` origin.

The profile is then read by **`legacy.businessAccountId`** — the account the map names — not by
`owner_user_id`.

Condition (4) is defence in depth over the database's own CHECK, **not a substitute for the
persisted map**: the map is read first and remains the trust boundary, and the locally computed
identifier is only ever used to _contradict_ it. Ownership, controller identity, team membership
and workspace ownership are consulted nowhere in this path.

Two ambiguity reasons were added for the contradictions this exposes — `non_deterministic_anchor`
and `origin_conflict` — alongside the existing `owner_mismatch`, `duplicate_legacy_mappings`,
`multiple_identities_resolved` and `orphan_initial_identity`.

### 18.4 Result shape

The projection now returns a discriminated result, matching the repository's existing
`found / not_found / ambiguous` convention:

| Outcome                            | Meaning                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `{ kind: 'found', projection }`    | A validated legacy anchor exists; the profile is projected                                           |
| `{ kind: 'no_legacy_anchor' }`     | Ordinary absence — a native BCI, or an identity that does not exist. No legacy Business is reachable |
| `{ kind: 'ambiguous', ambiguity }` | The anchor is contradictory. Fails closed, naming the reason                                         |

`no_legacy_anchor` is deliberately not an error: a natively created identity having no legacy
Business behind it is a normal fact about a normal identity, not a failure.

### 18.5 Behaviour

| Case                                              | Behaviour                                         |
| ------------------------------------------------- | ------------------------------------------------- |
| Initial BCI with a valid map                      | Projects its own Business profile                 |
| **Native BCI, same owner** (the merge blocker)    | `no_legacy_anchor` — the profile is never reached |
| BCI with no mapping                               | `no_legacy_anchor`                                |
| Identity that does not exist                      | `no_legacy_anchor`                                |
| Map names an account the identity is not owned by | `ambiguous: owner_mismatch`                       |
| Mapped identity is not the deterministic one      | `ambiguous: non_deterministic_anchor`             |
| Native-origin identity carrying a legacy anchor   | `ambiguous: origin_conflict`                      |
| Anchor duplicated across two Businesses           | `ambiguous: duplicate_legacy_mappings`            |
| Business A's BCI against Business B               | Reaches only A; B's BCI reaches only B            |

### 18.6 Tests added

Eight behavioural repository tests in `business-identity.compatibility.test.ts`, exercising the
real resolution path against a modelled database rather than asserting on source text:

1. a native BCI with the same owner does not project the legacy profile, while the initial BCI
   still does — the primary merge-blocker regression;
2. a BCI with no mapping reports no legacy anchor;
3. an identity that does not exist reports no legacy anchor;
4. an anchor naming another account fails closed as `owner_mismatch`;
5. a non-deterministic anchor fails closed;
6. a native-origin identity carrying an anchor fails closed;
7. a duplicated anchor fails closed rather than choosing one;
8. one owner controlling three identities keeps each one's compatibility state separate,
   re-checked after the unanchored identity is resolved so the result cannot depend on read
   order.

The cross-Business test was extended to assert both directions from one fixture.

**The tests were verified to bite.** Reverting the correction to the owner-only lookup fails
five of them, including the primary regression; restoring it returns the suite to green. A
regression test that has never been seen to fail is a comment.

### 18.7 Validation

| Check                     | Result                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| BCI compatibility suite   | **54 passing** (was 46)                                            |
| Ordinary `npm test`       | **949 passing** (was 941) — 20 shared + 609 api + 320 web          |
| `npm run typecheck`       | PASS                                                               |
| `npm run lint`            | PASS — `--max-warnings=0`                                          |
| `npm run validate:i18n`   | PASS                                                               |
| `npm run build`           | PASS                                                               |
| Prettier on changed files | PASS                                                               |
| `git diff --check`        | PASS                                                               |
| Migration 104             | **byte-for-byte unchanged** — no PostgreSQL re-validation required |

### 18.8 Files changed

- `apps/api/src/modules/business-identity/business-identity.repository.ts` — the projection
  binds to the authoritative legacy anchor; two ambiguity reasons added; the result becomes a
  discriminated union.
- `apps/api/src/tests/business-identity.compatibility.test.ts` — eight regression tests, and the
  four pre-existing projection tests updated to the new signature and result shape.

No migration, no authorization code, and no other module was touched.

### 18.9 Final B5 result

**B5 satisfied.** One owner may control multiple BCIs, and legacy compatibility now belongs to
the one identity the authoritative map anchors — proven by tests that fail without the
correction. The earlier claim in §3 and §10 that B5 was satisfied by the data model alone was
true of the schema and **not** true of the read path; both have been corrected in place rather
than left standing.
