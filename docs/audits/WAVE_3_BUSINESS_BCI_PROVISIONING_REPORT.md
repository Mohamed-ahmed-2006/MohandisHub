# Wave 3 Business Initial-BCI Runtime Provisioning

The precursor slice that closes the gap the Advertisement ownership review
found: a Business created after migration 104 received no commercial identity.

---

## 1. Verdict

**BUSINESS BCI PROVISIONING COMPLETE WITH NON-BLOCKING RISKS**

Every Business account created from now on ends its provisioning transaction
with exactly one deterministic initial BCI and exactly one authoritative legacy
mapping, or with no Business account at all. The identifier is the one migration
104 would have produced, because it is computed by the same function.

One non-blocking risk remains: Businesses created in the window **between**
migration 104 shipping and this slice deploying still have no identity. That
backlog is finite, documented in §16, and closed by the next asset migration's
own idempotent backfill — the pattern migration 105 already uses.

---

## 2. Base and Branch

|                 |                                               |
| --------------- | --------------------------------------------- |
| Worktree        | `D:\Private Projects\MohandisHub-wave3-final` |
| Branch          | `claude/wave3-business-bci-provisioning`      |
| Base commit     | `e816b0e971382af64e998af3200bb6104f6d9117`    |
| Migration added | **none** — see §15                            |

---

## 3. Business Creation Paths Discovered

Searched exhaustively rather than assumed: every `INSERT INTO users`, every
write to `primary_role`, every write to `business_profiles`, `business_teams`
and `business_members`, plus the route tables of `auth` and `admin`.

| Path                                                         | What it is                                                                                                                                                                                                               | Transaction         | Provisioned                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------- |
| `AuthRepository.reclaimAndCreateUser` (`auth.repository.ts`) | **Canonical registration.** Reached from `AuthService.register`, the only caller. Serializes on the email with `pg_advisory_xact_lock`, reclaims an abandoned unverified account, inserts the user and its role profile. | **One** transaction | ✅ yes                            |
| `AdminRepository.changeUserRole` (`admin.repository.ts`)     | **Real runtime role transition.** `PATCH /admin/users/:id/role`, `manage_users`. Updates `primary_role` and upserts the target role's profile.                                                                           | **One** transaction | ✅ yes                            |
| `AuthRepository.createUser`                                  | Predecessor of `reclaimAndCreateUser`. **Unreferenced** — no route, service, or test reaches it.                                                                                                                         | n/a                 | ❌ not a supported path (see §16) |
| `provisionWorkspace` (`business-teams.service.ts`)           | Lazy workspace creation for an account that is **already** a Business. Not an account-creation path.                                                                                                                     | One transaction     | ❌ out of scope (see §16)         |
| Invitation acceptance (`business-teams.service.ts`)          | Creates a **membership**, never a Business account.                                                                                                                                                                      | —                   | ❌ correctly none                 |

Findings against the Phase 1 questions:

1. **One transaction** creates the user and the Business profile. The workspace,
   its built-in roles and the owner membership are created **later and
   separately**, by `provisionWorkspace`, on first access to the team surface.
2. Business creation therefore **does** span more than one transaction overall —
   but the account and its profile, which is what makes an account a Business
   principal, do not.
3. **Canonical path:** `reclaimAndCreateUser`.
4. **Two** codepaths can produce a Business account (registration and the admin
   role change). Both are wired.
5. **Yes**, `primary_role` can become `'business'` after signup — via
   `AdminRepository.changeUserRole`. See §9.
6. **Yes**, a Business account exists without a workspace until it first opens
   the team surface. It never exists without a `business_profiles` row.
7. **No OAuth/social registration exists**, and there is **no admin
   create-user route** — both verified by search rather than assumed.

---

## 4. Provisioning Transaction Boundary

`ensureInitialBusinessCommercialIdentity(db, businessAccountId)` **never opens a
transaction of its own.** It takes the caller's client and runs inside the
transaction that establishes the Business, which is the only boundary that makes
the primary invariant true rather than probable:

```
BEGIN
  advisory lock on the email          (registration only)
  reclaim any abandoned account       (registration only)
  INSERT users  /  UPDATE primary_role
  INSERT business_profiles
  ensureInitialBusinessCommercialIdentity(client, id)   ← here
COMMIT
```

If provisioning throws, the existing `catch { ROLLBACK }` in both repositories
takes the account — or the role change — with it. A committed Business without
a commercial identity is not a state either path can produce.

Explicitly **not** used for the primary invariant: background jobs, retry
queues, frontend calls, after-response hooks, best-effort provisioning. The
`mapping_completed` outcome in §8 is the only repair behaviour, and it is
synchronous, inside the same transaction, and only reachable when nothing has to
be chosen.

The module is proved to hold this shape by source assertion, not just by
intent: it contains no `BEGIN`/`COMMIT`/`ROLLBACK`, no `getPool`, and no
`.connect(`.

---

## 5. Deterministic Identity Rule

**Reused, never restated.** The module imports
`deterministicInitialIdentityId` from `business-identity.constants.ts` — the same
function the BCI foundation ships and the same rule
`business_commercial_identity_deterministic_id` enforces as a CHECK constraint in
migration 104.

The provisioning module contains no hash, no namespace string, no UUID
construction and no `gen_random_uuid()`; a test asserts all of that against the
source, because a second generator would be a second answer to "which identity is
this Business's initial one".

Convergence is proved three ways in one assertion against a real server:

```
PostgreSQL  business_commercial_identity_deterministic_id($1)
TypeScript  deterministicInitialIdentityId(userId)
The row     business_commercial_identity_legacy_map.bci_id
```

all equal, for a Business the runtime path provisioned.

---

## 6. Idempotency

Read-first, then converge on primary keys:

1. Read the identity **at the deterministic id** and the mapping **for the
   account**, in one round trip.
2. Validate everything present. Fail closed on any contradiction.
3. Insert only what is missing, `ON CONFLICT DO NOTHING`.
4. Read back and re-validate.

Consequences:

- A Business that already has both rows costs **two SELECTs and zero writes** —
  asserted, because this runs on every Business registration.
- `created_at` is never moved by a re-run, on either row.
- The outcome is reported explicitly: `created`, `reused`, or `mapping_completed`.
- `created_by_migration` is written `false`, so migration-104 rows and
  runtime rows stay distinguishable to an auditor.

---

## 7. Concurrency

No advisory lock, no retry loop, no `FOR UPDATE`. Both inserts target keys whose
values are **fully determined by the account id**, so the database arbitrates:
the loser's `INSERT ... ON CONFLICT DO NOTHING` waits for the winner, does
nothing, and the read-back (a fresh snapshot at READ COMMITTED) sees the winner's
row. Lock order is identical on every caller — identity, then mapping — so there
is no cycle to deadlock on.

Proved against a real server with **ten concurrent transactions** provisioning
the same new Business, with per-attempt outcomes captured and asserted rather
than swallowed:

- **zero** rejected attempts — a signup that succeeded is never told a duplicate
  happened;
- all ten return the **same** `identityId`;
- exactly **one** reports `created`, the rest `reused`;
- exactly **one** identity row and **one** mapping row exist afterwards.

Four concurrent Business _registrations_ are separately proved to settle on four
distinct identities, one mapping each.

---

## 8. Corrupt-State Handling

Explicit named categories, returned as `409 BCI_PROVISIONING_FAILED` with
`details.reason`. Every one of them is a state the database already forbids;
they are checked anyway, because an operation that only behaves while its
constraints are intact behaves wrongly the one time they are not.

| Reason                      | Condition                                                                | Action      |
| --------------------------- | ------------------------------------------------------------------------ | ----------- |
| `not_a_business_account`    | The account does not exist, or is not a Business principal               | fail closed |
| `owner_mismatch`            | The deterministic identifier is held by a different account              | fail closed |
| `origin_conflict`           | It is held by this account but declares native origin                    | fail closed |
| `non_deterministic_mapping` | The account is anchored to an identity that is not its deterministic one | fail closed |
| `mapping_identity_missing`  | A mapping names an identity that does not exist                          | fail closed |
| `duplicate_legacy_mappings` | More than one mapping resolves for the account                           | fail closed |

**BCI exists, mapping missing → completed, not refused.** This is the one repair
performed, and it is safe precisely because nothing is chosen: the mapping is a
pure function of the account, and the checks above have already proved the
identity at that identifier is owned by this Business and declares legacy origin.
The database re-proves both — a deterministic `CHECK` and a composite foreign key
to `(id, owner_user_id)` — so a mapping that should not exist cannot be written
even if that reasoning were wrong. Outcome: `mapping_completed`.

**No contradiction is ever routed around by minting a second identity.** Every
failure case asserts that zero `INSERT` statements were issued. One Business
acquiring two identities is the failure the whole compatibility spine exists to
prevent, and a repair path that could cause it would be worse than the corruption
it repairs.

---

## 9. Role-Transition Behavior

A runtime transition into `primary_role = 'business'` **does exist**:
`AdminRepository.changeUserRole`, reached from `PATCH /admin/users/:id/role`
behind `manage_users`. It is wired.

- **Into Business** — provisions in the same transaction as the role change. The
  `UPDATE primary_role` is already visible to that transaction, which is what
  lets the Business-principal check pass before anything is written.
- **Refused spine** — the role change **rolls back**. Proved: after a refusal the
  account is still a `customer` and has no mapping. An account never claims to be
  a Business without an identity.
- **Out of Business** — the identity is **kept**. Identities are not deleted,
  ownership is not transferable self-serve, and assets already associated with
  the identity must stay associated.
- **Back into Business** — the **same** deterministic identity is reused, with
  its original `created_at`. No second identity is minted.
- **Into a non-Business role** — nothing is created.

No role-conversion feature was invented; the existing one was wired.

---

## 10. Advertisement Integration Proof

The gap the review found, closed end-to-end through real code — registration
repository, advertisement repository, ownership resolver — with **no migration
re-run**:

```
register('business')
  → initial BCI exists immediately
  → createPendingAdInTx + stampCommercialOwnerInTx
  → resolveAdvertisementOwnership
      kind:  'commercial_identity'
      source: 'assigned'
      state:  'commercial_identity_owned'
      identity: deterministicInitialIdentityId(user.id)
```

Before this slice the identical registration produced `legacy_user` /
`no_business_commercial_identity`.

Also proved:

- the row itself carries `commercial_owner_kind = 'business'` and
  `commercial_ownership_state = 'commercial_identity_owned'`;
- a **second native identity** created by the same owner afterwards captures
  nothing — both the earlier and the later campaign still resolve to the initial
  BCI, and zero advertisements point at the native identity. Wave 3 defines no
  reassociation, and none was implemented;
- an **Expert** campaign still resolves `legacy_user` /
  `awaiting_personal_commercial_identity`, exactly as the PCI slice expects.

---

## 11. Non-Business Isolation

The guarantee is not a check inside the primitive — it is that the primitive is
**not called**. It sits in the `case 'business':` branch of each path, once, and
a test asserts that no `break;` separates the branch label from the call.

Proved against a real server: Customer, Expert and Craftsman registration each
create zero identities and zero mappings; a mixed cohort of five registrations
produces exactly two identities for its two Businesses; and calling the primitive
directly on an Expert account is refused with `not_a_business_account` and writes
nothing.

Membership, permissions and workspace state are absent from the module —
`business_members`, `business_team_roles`, `business_teams`, `manage_team` and
`hasPermission` do not appear in it, asserted against the source.

---

## 12. Tests

**56 tests added** — 30 ordinary, 26 PostgreSQL-gated.

`apps/api/src/tests/business-identity.provisioning.test.ts` — 30 ordinary

Exactly one identity and one mapping; owner is the account; origin is
`legacy_business_account`; the identifier matches the shared helper; the mapping
is anchored to both; two Businesses get different identities. Re-running returns
the same identity, reports `reused`, moves no `created_at`, and issues no write
at all. A missing mapping is completed with a single insert. A concurrent writer
winning between the read and the insert converges without error. Five
contradiction cases, each asserting the named reason **and** that zero inserts
were issued. Customer, Expert, Craftsman and an unknown account are all refused.
Source assertions: the shared identifier rule is imported and no second
generator exists; no transaction is opened; convergence is by `ON CONFLICT`
rather than by lock or loop; runtime provenance is recorded; no membership state
is consulted; the primitive is wired into both paths, inside their transactions,
before their `COMMIT`, exactly once each, and only in the Business branch; and
migration 104's schema already holds everything written.

`apps/api/src/tests/business-identity.provisioning.pg.test.ts` — 26 gated

Registration commits account and identity together; one identity and one
mapping; runtime provenance; the PostgreSQL function, the TypeScript helper and
the written row agree. **Fault injection** at the identity insert leaves no
`users` row and no `business_profiles` row behind, and registration works again
once removed. Customer, Expert and Craftsman create nothing; a mixed cohort
produces exactly two identities; a direct call on an Expert is refused. A re-run
is inert including `created_at`; ten concurrent attempts all succeed on one
identity with exactly one `created`; four concurrent registrations settle on four
identities. `owner_mismatch` and `origin_conflict` are refused with nothing
minted; a missing mapping is completed; a native second identity cannot displace
the anchor. The admin transition provisions, rolls back on refusal, keeps the
identity across a switch away and reuses it on return, and creates nothing for
non-Business roles. Advertisement integration as described in §10.

Existing suites are unchanged and unaffected — no fixture in `auth`, `admin`,
`business-teams`, `business-identity` or `advertisements` needed adjusting.

---

## 13. PostgreSQL Validation

A **brand-new disposable local cluster**, created and destroyed for this
validation: PostgreSQL 18.4, `initdb` into a scratch directory outside the
repository, loopback only (`listen_addresses=127.0.0.1`), temporary port `55434`,
Supabase compatibility roles `anon`/`authenticated`/`service_role` created,
`PG_INTEGRATION_URL` supplied per command and never written to a file, cluster
stopped and its data directory deleted afterwards. The persisted workstation
cluster was never touched; no staging or production database was contacted.

| Run                      | Result                             |
| ------------------------ | ---------------------------------- |
| Provisioning suite alone | **26/26 passing**                  |
| Full gated api suite     | **1070 passing, 2 failing (1072)** |

The two failures are the same **known pre-existing PostgreSQL 18 catalog
fingerprint failures** carried on main —
`advertisements.weekly-billing.pg` and `business-teams.workspace.pg` schema
reversal tests, both tripping on PG 18 recording NOT NULL constraints as named
`pg_constraint` rows for columns introduced by earlier waves. The repository's
committed Supabase configuration targets PostgreSQL 17, where they do not arise.
Unrelated to this slice and not repaired here.

No migration was added, so a full 1→105 replay was not required. Each scratch
database is nonetheless built by replaying every migration from zero, so the
provisioning suite ran against the complete, current schema.

---

## 14. Ordinary Validation

| Check                    | Result                                                   |
| ------------------------ | -------------------------------------------------------- |
| `npm test`               | **1029 passing** (was 999) — shared 20, api 689, web 320 |
| `npm run typecheck`      | pass (shared, api, web)                                  |
| `npm run lint`           | pass, `--max-warnings=0`                                 |
| `npm run validate:i18n`  | pass                                                     |
| `npm run build`          | pass                                                     |
| Prettier (changed files) | clean                                                    |
| `git diff --check`       | clean                                                    |

---

## 15. Schema/Migration Impact

**No migration was added. Migration 106 does not exist.**

Migration 104 already ships everything this slice writes: both spine tables, the
deterministic `CHECK` on the mapping, the composite foreign key from the mapping
to `(id, owner_user_id)`, the primary keys both inserts converge on, and the
`created_by_migration` provenance column with a `false` default intended for
exactly this. Runtime provisioning is logic, not schema, and adding a migration
for it would have been churn.

Migrations 1–105 are byte-for-byte unchanged.

---

## 16. Known Risks

1. **The pre-existing backlog is not retro-provisioned.** Businesses created
   between migration 104 shipping and this slice deploying still have no
   identity. They remain safe — they stay in legacy compatibility mode, which
   the Advertisement resolver handles as `no_business_commercial_identity` and
   authorizes no more loosely than before. In a normal deploy sequence 104, 105
   and this slice ship together and the window is empty. **Remedy:** the Services
   ownership migration must re-run the idempotent 104 backfill before its own,
   exactly as migration 105 drives everything from the map. `idx_advertisements_ownership_unresolved`
   already finds the affected advertisements. Adding a data-only migration here
   was deliberately declined per the slice's no-migration scope.

2. **`AuthRepository.createUser` is unreferenced but still present.** It creates
   a user outside any transaction and would not provision. Nothing calls it — no
   route, service or test — so it is not a supported creation path, but it is a
   latent hazard if a future change reaches for it. Removing it is a trivial
   cleanup that belongs to its own change, not to this one.

3. **Workspace provisioning is not a provisioning point.** `provisionWorkspace`
   runs for an account that is already a Business and would have been a natural
   catch-up hook for risk 1. It was deliberately left alone: it is gated on the
   JWT's `actor.role`, so a stale token could send a non-Business account into a
   `not_a_business_account` refusal and break workspace creation where it
   previously worked. The narrower wiring is the safer one.

4. **BCI status enforcement remains deferred**, as agreed, to the Suspension and
   Enforcement slice. Provisioning always mints `status = 'active'`; nothing here
   reads status.

---

## 17. Recommended Next Slice

**Services ownership re-association onto the Commercial Identity spine.**

The precursor the Advertisement review required is now in place: a Business
created today has its initial BCI before it can own anything, so the Services
migration will not be re-associating assets for accounts that have no identity to
re-associate them to.

Services carries the same legacy shape as advertisements —
`services.provider_id` referencing a login account, with the same mixed
Business / Expert / Craftsman population — so the pattern transfers directly:
additive typed columns, a composite foreign key targeting the legacy map, a dual
read that prefers the canonical owner and fails closed on contradiction, and an
authorization gate that resolves authority through the identity. Its migration
should open by re-running the idempotent 104 backfill, which also closes risk 1.

Not implemented here.
