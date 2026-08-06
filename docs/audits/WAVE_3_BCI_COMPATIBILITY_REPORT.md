# Wave 3 BCI Compatibility Report

**Slice:** Wave 3 slice 1 — additive Business Commercial Identity compatibility.
**Date:** 2026-08-06.
**Worktree:** `D:\Private Projects\MohandisHub-wave3-final`.
**Branch:** `codex/wave3-bci-compatibility` (continued; not renamed, no duplicate branch created).

---

## 1. Verdict

**BCI SLICE COMPLETE WITH NON-BLOCKING RISKS.**

The additive spine, the deterministic backfill, the constraint set, the domain layer, the
authorization boundary and the B1–B5 coverage are all implemented and committed. The full
ordinary validation chain passes.

The single non-blocking risk is that the new migration has **not been executed against a real
PostgreSQL server** in this session: no disposable scratch database was configured, and
inventing a `DATABASE_URL` was out of scope. The 22 migration tests that would prove it are
written, committed and skipped. See §14.

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

| #      | Requirement                                                                                                                      | Implementation                                                                                                                                                                                                             | Tests                                                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | A legacy Business account maps to **exactly one** initial BCI, deterministically; re-running creates none                        | `business_commercial_identity_deterministic_id()`; `PRIMARY KEY (business_account_id)`; `UNIQUE (bci_id)`; `CHECK (bci_id = deterministic(business_account_id))`; backfill with `ON CONFLICT … DO NOTHING` on both inserts | `B1 — a legacy Business account maps to exactly one initial BCI` (6 tests) + pg `deterministic backfill` / `idempotency and concurrency` (9)                                                    |
| **B2** | **Team/workspace IDs remain unchanged** across the migration                                                                     | The migration issues no `INSERT`/`UPDATE`/`DELETE`/`ALTER` against `business_teams`; the table is read only by the preflight                                                                                               | `renumbers no workspace…`, `writes only to the two tables it creates`; pg `leaves team IDs, members, roles, invitations and profiles byte-identical`                                            |
| **B3** | **Memberships, invitations, roles and audit history remain unchanged**, including roles carrying a reserved permission           | Same: `business_members`, `business_team_roles`, `business_team_invites`, `business_team_audit_log` are never written                                                                                                      | `renumbers no workspace…`; pg `…byte-identical` (seeds a role carrying `manage_jobs` + `view_analytics`) and `preserves a reserved permission on the role that carries it`                      |
| **B4** | **User-owned historical assets remain readable** throughout the compatibility period                                             | No asset is re-keyed, no owner column is added, no BCI column is made mandatory anywhere. `business_profiles.user_id` remains the profile owner and the legacy read path is untouched                                      | `adds no owner column to any existing commercial asset`; pg `leaves every existing commercial asset ownership column untouched`; projection tests prove the same profile row resolves both ways |
| **B5** | **One owner may control multiple BCIs without asset mixing** — assets, balance, reputation and enforcement stay separate per BCI | `owner_user_id` is indexed but deliberately **not** unique; only the _initial_ identity is mapped, so a second identity the same owner controls has no legacy anchor and no shared row. No aggregate is computed anywhere  | `B5 — one owner may control multiple BCIs without asset mixing` (3 tests) + the no-asset-mixing group                                                                                           |

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

| Guarantee                                            | How                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Business A's BCI never resolves Business B's profile | The projection reads `business_profiles` by `identity.ownerUserId` only; tested with two seeded Businesses                    |
| Business A's team cannot attach to Business B's BCI  | The BCI schema has no team column at all, and the migration writes nothing to any team table                                  |
| A malformed mapping never picks a random BCI         | `CHECK (bci_id = deterministic(business_account_id))` in the database; named ambiguity instead of `rows[0]` in the repository |
| No cross-BCI aggregation exists                      | `listIdentitiesControlledBy` returns rows; nothing sums, averages or joins across identities                                  |
| No existing commercial asset is reassigned           | Zero writes outside the two new tables, asserted by parsing the migration's own statements                                    |
| Two Businesses cannot share one identity             | `UNIQUE (bci_id)` on the map, plus the composite foreign key                                                                  |

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

| Suite                                     | Tests                                    |
| ----------------------------------------- | ---------------------------------------- |
| `business-identity.compatibility.test.ts` | 46 passing (no database required)        |
| `business-identity.migration.pg.test.ts`  | 22, PostgreSQL-gated (skipped — see §14) |

**Ordinary counts:**

| Point                           | Passing          |
| ------------------------------- | ---------------- |
| Before Phase 0                  | 894 (+1 failing) |
| After Phase 0 (target baseline) | **895**          |
| After the BCI slice             | **941**          |

941 = 20 (shared) + 601 (api) + 320 (web). The delta is exactly the 46 new compatibility tests.

**Skipped PostgreSQL tests: 331** — 309 pre-existing plus the 22 added by this slice.

---

## 13. Validation

| Check                       | Result                                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                  | **PASS** — 941 passing, 331 skipped                                                                                                                                                                                    |
| `npm run typecheck`         | **PASS**                                                                                                                                                                                                               |
| `npm run lint`              | **PASS** — `--max-warnings=0`, api and web                                                                                                                                                                             |
| `npm run validate:i18n`     | **PASS**                                                                                                                                                                                                               |
| `npm run build`             | **PASS**                                                                                                                                                                                                               |
| Prettier on changed files   | **PASS** (`.sql` has no Prettier parser and is not covered)                                                                                                                                                            |
| `git diff --check`          | **PASS** — no whitespace errors                                                                                                                                                                                        |
| Migration static validation | **PARTIAL** — structure verified (balanced `$$`, parentheses, quotes; 3 `DO` blocks all closed). `scripts/migration-dryrun.mjs` and `scripts/migration-replay-check.mjs` both require `DATABASE_URL` and could not run |

---

## 14. Known Risks

1. **The migration has not been executed against a real PostgreSQL server.** This is the only
   material risk in the slice. No `apps/api/.env` exists, `PG_INTEGRATION_URL` is unset, and
   inventing a connection string was out of scope. The migration's structure was verified
   statically and every construct used is standard (`md5`, `overlay`, `position`, `format`,
   plpgsql `DO` blocks, composite foreign keys, a CHECK calling an `IMMUTABLE` function), but
   _statically verified_ is not _executed_.
   **Mitigation:** run `RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api` against a
   disposable scratch database before applying this migration anywhere. The 22 tests that
   prove it are already written and committed.
2. **A CHECK constraint calls a user-defined function.** Supported and `IMMUTABLE`, but it makes
   `pg_dump` restore order matter — the function must exist before the table. Within this
   migration it does, and a clean replay builds them in order.
3. **The preflight can block a deployment.** If production holds a workspace whose owning account
   has drifted out of the `business` primary role, the migration aborts by design. That is the
   fail-closed posture the architecture requires, and the error message names the repair. The
   `20260731120000` header records that production held none of the equivalent states.
4. **`ON DELETE CASCADE` on `owner_user_id`.** Deleting a Business account removes its BCI. This
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
