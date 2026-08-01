# Wave 2 final launch acceptance audit

Date: 2026-08-01

Audit branch: `audit/wave-2-final-acceptance`

Audit base: `origin/main` at `417d9112d5ea2f702217e61ad7a1748ff20ff8b4`

Worktree: `D:\Private Projects\mohandishub-wave2-final-audit` (isolated; no
migration applied, no production row written)

Scope: Wave 2F (advertisement billing), Wave 2G-A (team administration),
Wave 2H (invitations) and Wave 2I (Help & Resolution), all of which are already
merged, migrated, deployed and production-verified. This audit confirms the
delivered state and names what remains deferred. It does not rebuild delivered
features and does not begin Wave 3.

The canonical public domain remaining in maintenance mode is a deliberate launch
posture and is not treated here as a product defect.

---

## Executive verdict

**APPROVED_WITH_NON_BLOCKING_FOLLOWUPS**

Every launch-critical invariant this audit was asked to verify holds, in the
repository and in production. Git history is linear, the repository and the
production database agree exactly at the 103-migration boundary, no EGP wallet
path was reintroduced, no plan and no advertisement can be charged for today,
workspace and case authorization are enforced server-side on every read, and the
protected cross-subsystem tests are intact and in several places stronger than
before Wave 2.

All eight validation commands passed, and all 320 real-PostgreSQL assertions
passed when the opt-in suites were run serially against freshly built scratch
databases.

Nothing found blocks launch. Four non-blocking follow-ups are recorded below;
the most substantive is a stale comment block in a financial file that now
describes code that no longer exists.

---

## A. Git and migration integrity

**Verdict: PASS.**

| Check | Result |
| --- | --- |
| `main` history linear | 218 commits, `rev-list` = `rev-list --first-parent` = 218 |
| Merge commits on `main` | 0 across the entire history |
| Root commits | 1 (`c66d1cc`) |
| Wave 2F→2I integration commits | 76, all linear, zero merges |
| Repository migration files | 103 |
| Production applied migrations | 103 |
| Pending migrations | 0 |
| Repository/production history alignment | no live version absent from the repo; no repo version absent from live |
| Clean replay fingerprint | columns 1328 MATCH, constraints 557 MATCH, indexes 394 MATCH |
| Scratch database leakage | none; `mhc_replay_*` and `mhc_it_*` both verified empty |

The replay check builds the schema from nothing into a scratch database, diffs
it against the live structure, and drops the scratch database from a `finally`
block, then re-asks the server what remains. It reported `verified: no
mhc_replay_* or mhc_it_* database remains`.

The fingerprint reconciles cleanly against the previous audit
(`docs/audit/2026-08-01-wave-2i-final-integration.md`), which measured the live
boundary at 102 applied migrations and recorded columns 1283 / constraints 519 /
indexes 374. The deltas (+45 columns, +38 constraints, +20 indexes) are exactly
the objects `20260801090000_unified_help_resolution_cases.sql` creates, which is
independent corroboration that Wave 2I was applied to production and nothing
else was.

### The eight reviewed migrations

All eight carry an explicit, idempotent `ROLLBACK` block in reverse dependency
order, and all eight assert their own end state in a `DO $$` block that raises
rather than committing a wrong shape.

| Migration | Reviewed conclusion |
| --- | --- |
| `20260729140000_mhc_action_charges` | Charge ledger with two structural idempotency indexes (`action_key, reference_type, reference_id` and a `user_id`-scoped retry key). `ON DELETE RESTRICT` to `users` and `transactions`. Rollback header enumerates both later dependants and the third-level dependant, in the order that actually works. |
| `20260729150000_advertisement_mhc_pricing` | Activates the `advertisement` price without setting it; adds advertiser-scoped create idempotency; labels EGP columns legacy without dropping any. |
| `20260730090000_plan_subscriptions_launch_freeze` | Moves the plan freeze from a hand-edited row to a schema default, and asserts zero unfrozen settings rows. |
| `20260730100000_plan_mhc_pricing` | Introduces scoped per-entity pricing; `plans.is_purchasable` defaults **false**; lifts the global pause but asserts zero purchasable plans and an empty scope table on exit. Composition is fail-closed: purchasable **and** an active scoped price are both required. |
| `20260730120000_advertisement_weekly_billing` | Period table with `CHECK (ends_at = starts_at + interval '168 hours')` — hours, not calendar days, so a DST boundary cannot produce a 167- or 169-hour week. `EXCLUDE USING gist` with `'[)'` bounds makes consecutive weeks adjacent, not overlapping. Asserts nothing became weekly-billed, no period exists, and the price is still 0. |
| `20260731090000_advertisement_automatic_renewal` | Consent is structural: `chk_advertisements_auto_renew_consent` makes the flag uncommittable without a recorded consenter and timestamp. Boundary event log doubles as dedup identity, no-repeat-debit gate, leased outbox and provider history. Asserts nothing auto-renews and the price is still 0. |
| `20260731120000_business_workspace_membership_invariants` | Preflight refuses three unrepairable states rather than half-migrating. Upper owner bound is a partial unique index; the lower bound is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger, so an ownerless *instant* is legal and an ownerless *commit* is not. Backfills precede constraints. `token_hash` is constrained to 64 lowercase hex, an alphabet raw base64url tokens cannot satisfy. |
| `20260801090000_unified_help_resolution_cases` | Additive spine beside both legacy engines; neither is rewritten. `chk_resolution_cases_safety_is_private` makes a safety report structurally unreadable by its subject. Backfill is `WHERE NOT EXISTS`, so re-running is safe. |

`node scripts/migration-dryrun.mjs` reported `Repo migrations: 103 Applied: 103
Pending: 0 / Nothing pending`, so there was nothing to dry-run and nothing was
applied.

---

## B. MHC and financial invariants

**Verdict: PASS.**

- **No EGP wallet path was reintroduced.** No Wave 2 module contains an EGP
  wallet read or debit. `plans.service.ts` contains neither
  `debitWalletInTransaction` nor any `FROM wallets` query — an assertion the
  protected suite now makes explicitly. The only EGP references left in the
  advertisement module are the retained legacy-campaign refund path and column
  comments.
- **Debits are transactional and idempotent.** `chargeAction` runs price
  resolution, wallet lock, balance check, charge insert, guarded debit and
  ledger write in one savepoint-scoped sequence inside the caller's
  transaction. A 402 rolls back to the savepoint, leaving the caller's
  transaction usable and no partial row behind.
- **No negative balance is possible.** The debit is
  `UPDATE wallets SET balance = balance - $2 WHERE id = $1 AND balance >= $2`,
  in `NUMERIC` rather than JS floats, behind a `FOR UPDATE` row lock, with
  `chk_wallets_balance_nonnegative` (`20260610125500`) as the backstop.
  Production holds zero negative wallets.
- **Advertisement submission creates no charge.** The create path opens one
  transaction, writes one `pending_review` row, and never touches the charge
  primitive — proven both by unit assertion (`charges nothing even when a
  non-zero weekly price is configured`) and against real PostgreSQL (`does not
  so much as create an MHC wallet`).
- **Renewal creates at most one period and one charge.** Four independent
  mechanisms overlap: `uq_ad_period_number`, `uq_ad_period_active`,
  `uq_ad_period_action_charge` and `uq_mhc_action_charge_reference`. Ten
  concurrent renewals, ten concurrent approvals, ten concurrent due-start calls
  and a manual-versus-automatic race each produce exactly one week.
- **Plan pricing is server-controlled.** No caller supplies a price; a consumer
  passes a *scope* and the primitive resolves the price itself. A paid plan with
  no active scoped price fails closed with `PLAN_MHC_PRICE_MISSING`.
- **Advertisement price remains 0** and the action row remains active — an
  active row priced 0 is the supported way to express "free", because the
  primitive fails closed on an inactive price rather than treating off as free.
- **Historical records are untouched.** 141 transactions, 22 wallets, no
  negative amount, no hold exceeding its wallet. The 59 historical completed
  transactions lacking `balance_delta` are exactly the 59 the previous audit
  recorded; the dry-run classifies them as advisory (pre-existing data quality)
  rather than blocking, and no Wave 2 migration writes to them. There are zero
  MHC-wallet transactions in production, so nothing Wave 2 built has yet moved a
  credit.

---

## C. Advertisement lifecycle

**Verdict: PASS.**

- **Moderation cannot be bypassed.** `assertModeratable` reads the moderation
  columns; activation is gated on approval, not inferred from billing state.
- **Provider status editing cannot activate an ad.** `status` was removed from
  the update schema entirely — the suite asserts the create schema has no price
  field, no duration field and no status field — and edits are refused outright
  once a weekly campaign leaves `pending_review`.
- **Expired periods never serve.** Serving requires a live paid week
  independently of the mirrored campaign window, so a lost expiry write, a stale
  mirror, a missing period row and a concurrent expiry sweep all still hide the
  campaign.
- **Renewal races produce one period.** Verified against real PostgreSQL at 2
  and 10 concurrent workers, across manual, automatic and mixed races, and after
  a lost response.
- **Cancellation cannot refund a started week.** `cancelWeeklyAd` performs no
  refund calculation and makes no wallet call at all; the legacy prorated EGP
  refund is retained only for `billing_model = 'legacy'` campaigns.
- **Insufficient credits cannot repeatedly debit or notify.**
  `auto_renew_paused_reason` is the no-retry-loop gate and is excluded from the
  scheduler's candidate index, so a failed boundary leaves the index entirely.
  Clearing it is an explicit advertiser action, never a sweep.
- **Legacy advertisements cannot enter weekly renewal.** `billing_model`
  defaults to `legacy`, every weekly index is partial on `weekly`, and the
  service layer refuses legacy campaigns on the enable, claim and renew paths.
- **Delivery semantics are documented honestly.**
  `docs/release/ADVERTISEMENT_BILLING.md` §5A states plainly that the boundary
  event and the in-app notification row are exactly once and that web push and
  email are at-least-once, names the exact window in which a duplicate is
  possible, and explains why stamping delivered before the external send would
  be the worse failure.

---

## D. Team and invitation security

**Verdict: PASS.**

- One workspace per business account: `uq_business_teams_business_id`, which is
  also the `ON CONFLICT` target that makes first-access provisioning idempotent.
- Exactly one owner at commit: partial unique index above, deferred constraint
  trigger below. Production holds one workspace with exactly one owner and zero
  workspaces failing the count.
- Ownership transfer is unavailable in both directions:
  `allowedActionsFor` reports `transferOwnership: false` for everyone including
  the owner; the API route exists and always throws
  `409 OWNERSHIP_TRANSFER_NOT_AVAILABLE` without reading a membership, taking a
  lock or writing an audit row; the web client has no such method, and a test
  asserts its absence.
- The primary account role is untouched on join — `acceptInvite` writes no
  `users` row — and `readWorkspaceContext` does not read `primary_role` at all,
  which is what lets a customer, expert or craftsman hold a membership.
- Wrong-account acceptance fails **before** status is examined, so a stranger
  holding a leaked link learns only that it is not theirs.
- Raw tokens are never stored: issued as base64url, stored as lowercase-hex
  SHA-256, with a CHECK whose alphabet the raw form cannot satisfy. Production
  holds zero invitations with a malformed digest.
- The URL token is captured into `sessionStorage` and removed with
  `history.replaceState`, so it survives sign-in / sign-up / verification
  redirects without persisting in history, `Referer` or a screenshot, and is
  forgotten on every terminal outcome.
- Concurrent acceptance creates one membership: `SELECT … FOR UPDATE` on the
  invitation serialises accepts and revokes; an already-accepted retry reports
  the existing state and creates nothing; an existing membership is never
  overwritten, so an old link cannot silently demote a sitting Admin.
- Removed members lose access at the next request, not the next token refresh,
  because the resolver requires a live membership row.
- Deferred permissions are honest: exactly one of the seven storable
  permissions (`manage_team`) is read by an authorization decision. The other
  six are reported separately as *reserved*, are never counted by
  `hasPermission`, and are not deleted from roles that already carry them.
- Cross-workspace operations are denied by construction: a client-supplied
  `teamId` is matched inside the resolver's own membership query, so it can only
  narrow the caller's existing set; member and role writes are scoped to
  `context.teamId`; and `loadAssignableRole` rejects the owner role and any role
  from another workspace.
- Historical invitations retain `role_name_snapshot`, written once at creation
  and never rewritten, so a revoked invitation to a since-deleted custom role
  still reads correctly.

---

## E. Help & Resolution security

**Verdict: PASS.**

- Unrelated callers get `404 CASE_NOT_FOUND` with no metadata, on the detail
  route and on both historical deep-link lookups. The list query applies the
  same predicate in SQL, so the two cannot drift.
- Counterparty access is explicit: the API reads only `counterparty_access`.
  `chk_resolution_cases_counterparty_access` refuses a stray `true` with no
  counterparty to grant it to.
- Revocation is immediate and total. The same
  `counterparty_id = $1 AND counterparty_access = true` predicate governs the
  case read, the list, and — separately, in the upload repository — every
  evidence file read.
- Safety reports cannot expose a counterparty:
  `chk_resolution_cases_safety_is_private` makes `counterparty_id` and
  `counterparty_access` unstorable on that kind, `notifyParticipants` never
  addresses `reported_user_id`, and production holds zero safety cases with a
  counterparty.
- Evidence is reauthorized on **every** private read.
  `GET /api/upload/private/:id` answers from the case, never from anything the
  client sent; the response carries an authenticated API path, never a storage
  path or a bucket-signed URL.
- KYC and identity documents cannot be reached through case permissions, from
  either direction. A support admin is scoped by `isResolutionCaseEvidence` and
  does not inherit the blanket private-upload read that verification and money
  admins hold; and `privateUploadIsAttachableEvidence` — in both the
  help-resolution and reservations repositories — refuses to attach any upload
  referenced by `identity_documents` or `academic_records`, matching both the
  stored path form and the `/api/upload/private/<id>` URL form.
- Message, timeline entry and status change are atomic. `writeNativeMessage`
  takes one pooled connection, locks the case `FOR UPDATE`, re-checks terminal
  status under the lock, then writes the message, the event and the status in
  one transaction. Evidence, escalation, counterparty-access changes and
  resolution follow the same shape.
- Internal admin notes are filtered in SQL, not in the projection: native
  messages, reservation dispute notes, timeline events and the message *count*
  each exclude admin-visibility rows for participants. Posting one as a
  participant is refused outright rather than silently downgraded, and posting
  one on a support ticket is refused with
  `409 INTERNAL_NOTES_NOT_SUPPORTED` rather than published to the ticket owner.
- Reservation disputes cannot be financially resolved through the generic
  resolver. `ensureAdminMayWriteStatus` refuses both `setAdminStatus` and
  `resolve` for that kind and names the reservation endpoint that settles the
  money in the same transaction; `capabilities.canResolve` is false and
  `resolutionHandledBy` says so.
- Historical support and dispute records are unchanged. The spine is additive
  and trigger-synchronized; the only edit to the reservations module in all of
  Wave 2 is the hardened evidence-attachability guard described above.

---

## F. Cross-subsystem isolation

**Verdict: PASS.**

Traced across the full Wave 2 file set (89 files, `1f9c123..417d911`):

| Protected boundary | Result |
| --- | --- |
| Award and booking activation | Untouched |
| `ActivationGateService` | Untouched — `mhc/activation-gate.service.ts` is not in the Wave 2 diff |
| Contact redaction | Untouched — the `chat` module is not in the Wave 2 diff |
| Provider payment-method disclosure | Untouched — the `provider-payments` module is not in the Wave 2 diff |
| Payment webhooks | Untouched |
| Plans | Changed deliberately (per-plan MHC pricing); zero purchasable in production |
| MHC package purchasing | Untouched |
| Historical EGP records | Preserved; columns retained and relabelled, never dropped or rewritten |
| Business teams vs. Help & Resolution | No shared authorization path; no workspace role grants case access |
| Advertisements vs. team membership | No coupling; advertisement ownership is `advertiser_id`, never a workspace role |

The two reservation-module edits are a rename
(`privateUploadBelongsToUser` → `privateUploadIsAttachableEvidence`) and the
KYC-exclusion predicate behind it. The dispute settlement transaction is
byte-for-byte unchanged.

**Protected tests remain semantically intact, and in two places stronger.**
`phase1-trust-ops` tracks the rename only. `phase2_5-product-value` re-anchors
the built-in-roles assertion to the file the model moved into and *adds* a
second assertion. `phase4-marketplace-money` re-anchors the ordering assertion
from the retired `debitWalletInTransaction` to `this.mhc.chargeAction` and adds
a new test asserting `plans.service.ts` contains no `debitWalletInTransaction`
and no `FROM wallets` at all.

`advertisements.mhc.test.ts` (437 lines, 21 assertions) was deleted. This is
correct rather than a weakening: every assertion in it described charging at
*campaign creation*, which Wave 2F-A deliberately replaced with charging per
seven-day period. Each claim has a stronger successor — the replacement
moderation suite (723 lines) plus two real-PostgreSQL suites carry roughly 160
assertions over the same ground, including cases the deleted file never had
(concurrency at ten workers, transaction-boundary rollback, schema-level
constraint proofs, and documented-rollback replay).

No test was skipped, weakened, or had an assertion removed without a stronger
replacement.

---

## G. Navigation, localization and presentation

**Verdict: PASS.**

- One navigation entry per feature. Support and Disputes were merged into a
  single `/app/help-resolution` entry; the two legacy sidebar entries were
  removed.
- No duplicate Support/Disputes navigation. The merged entry is hidden only if
  an admin had hidden **both** legacy entries — failing towards keeping access
  people already have.
- Historical routes remain compatible. `/app/support` and `/app/disputes` both
  still resolve and render the unified screen with the corresponding tab
  preselected; historical deep links resolve server-side under the same
  visibility rule as every other read.
- Team Owner terminology is precise. Three product tiers (Owner, Admin, Member);
  the stored `manager` value is presented as Admin and never shown as a tier of
  its own; the legacy `viewer` seed is classified `is_legacy` rather than
  deleted, is no longer seeded, and is not offered.
- Deferred permissions are presented honestly — see section D.
- Arabic RTL and English LTR are complete, and **there is no untranslated Wave 2
  string**. A structural comparison of the two dictionaries gives 1692 keys
  each, zero keys missing in either direction, and exactly two identical string
  values — both email-format placeholders (`new@email.com`,
  `name@example.com`), which are correct to leave untranslated. Every Wave 2
  stylesheet uses logical properties or explicit `[dir]` rules.
- Mobile layouts are bounded near 375px: Wave 2 stylesheets use `max-width`
  container caps and mobile-first breakpoints only, with an explicit
  `@media (max-width: 375px)` block in the case thread. No fixed `min-width`
  wide enough to overflow a 375px viewport exists in any Wave 2 stylesheet.
- No private identifier or token is rendered as meaningful UI. The `id` values
  present in the Wave 2 components are React `key`, `<option value>` and
  `data-testid` uses, none of which are user-visible text. See follow-up F3 for
  the single cosmetic exception.

---

## H. Production-state reconciliation (read-only)

Every statement was a `SELECT` executed inside a `BEGIN READ ONLY` transaction
that was then rolled back. Nothing was mutated.

| Check | Expected | Observed |
| --- | --- | --- |
| Applied migrations | 103 | **103** |
| Advertisements | 0 | **0** |
| Advertisement campaign periods / renewal events | 0 | **0 / 0** |
| Advertisements with automatic renewal enabled | 0 | **0** |
| Advertisement weekly price (MHC) | 0 | **0.00**, action row active |
| Purchasable plans | 0 | **0** |
| Active scoped plan prices | 0 | **0** |
| MHC action charges | 0 | **0** |
| Business workspaces | 1 | **1** |
| Business accounts owning >1 workspace | 0 | **0** |
| Workspaces without exactly one owner | 0 | **0** |
| Invitations with a malformed token digest | 0 | **0** |
| Support tickets → resolution spine rows | 2 → 2 | **2 → 2**, all `general_support` |
| Orphaned spine rows (either direction) | 0 | **0** |
| Tickets or disputes missing a spine row | 0 | **0** |
| Safety cases carrying a counterparty | 0 | **0** |
| Wallets with a negative balance | 0 | **0** |
| Transactions with a negative amount | 0 | **0** |
| Wallet holds exceeding their wallet | 0 | **0** |
| Completed transactions without `balance_delta` | 59 (advisory) | **59** — unchanged |
| Scratch or fixture data | none | **none** — zero `mhc_replay_*`/`mhc_it_*` after the run, zero fixture accounts |

Aggregates: 22 wallets (21 EGP/money summing 0.00, 1 MHC/provider_credit
summing 0.00), 141 transactions, of which **0** touch an MHC wallet, 29 live
users, 1 business member, 0 invitations, 0 reservation disputes, 0 native case
messages or evidence. These are consistent with the previous verified snapshot:
the transaction count, the wallet count and the 59-row advisory are all
unchanged, and no Wave 2 feature has yet moved a credit in production.

`app_settings.pause_plan_subscriptions` is `false`, as `20260730100000`
intends. This is not a purchasability risk on its own: purchasing additionally
requires `plans.is_purchasable = true` **and** an active scoped MHC price, and
production has zero of each.

---

## Test results

All eight validation commands were run sequentially in the audit worktree
against a clean `npm ci`, in the order specified.

| Step | Command | Result |
| --- | --- | --- |
| 1 | `npm run typecheck` | **exit 0** |
| 2 | `npm run lint` | **exit 0** (`--max-warnings=0`, api and web) |
| 3 | `npm run validate:i18n` | **exit 0** |
| 4 | `npm run test` | **exit 0** — shared, API 522 passed / 7 files skipped, web 292 passed |
| 5 | `npm run build -w @mohandishub/api` | **exit 0** |
| 6 | `npm run build -w @mohandishub/web` | **exit 0** |
| 7 | `node scripts/migration-dryrun.mjs` | **exit 0** — 103 applied, 0 pending |
| 8 | `node scripts/migration-replay-check.mjs` | **exit 0** — exact match, scratch dropped and verified |

The 7 files skipped in step 4 are the opt-in real-PostgreSQL suites, which
require `RUN_PG_INTEGRATION=1`. They were then run **serially**, one suite per
process, each against its own freshly created scratch database built by
replaying all 103 migrations from nothing:

| Suite | Tests | Duration |
| --- | --- | --- |
| `mhc.action-charge.pg.test.ts` | **19 passed** | 204s |
| `plans.mhc-pricing.pg.test.ts` | **18 passed** | 131s |
| `advertisements.weekly-billing.pg.test.ts` | **82 passed** | 603s |
| `advertisements.automatic-renewal.pg.test.ts` | **80 passed** | 1137s |
| `business-teams.invariants.pg.test.ts` | **27 passed** | 203s |
| `business-teams.workspace.pg.test.ts` | **37 passed** | 398s |
| `help-resolution.pg.test.ts` | **44 passed** | 285s |
| `migration-scratch-cleanup.test.ts` (PG block) | **13 passed** | 6s |
| **Total** | **320 passed, 0 failed** | ~49 min |

These suites are where the launch-critical claims are actually proved rather
than modelled: real `FOR UPDATE` blocking, real MVCC visibility at READ
COMMITTED, real unique indexes, real CHECK constraints, ten-worker concurrency,
transaction-boundary rollback, and each migration's documented rollback replayed
twice against a schema built from nothing.

After the full run, the production server was re-queried: **zero** `mhc_replay_*`
or `mhc_it_*` databases remain, and every production figure in section H is
byte-identical to its pre-run value (103 migrations, 0 advertisements, 1
workspace, 2 tickets, 2 spine rows, 22 wallets, 141 transactions, the same 59
advisory rows, no fixture accounts). No scratch database was ever pointed at the
live database: `assertNotProduction` re-reads `SELECT current_database()` on the
connection that is about to be written to and refuses anything without the
`mhc_it_` prefix.

No test was modified, skipped or weakened for this audit.

---

## Launch blockers

**None.**

---

## Non-blocking follow-ups

**F1 — A stale comment block in a financial file describes code that no longer
exists.** `apps/api/src/modules/plans/plans.service.ts:281-284` states that
"everything below the pause guard is the LEGACY EGP implementation… it reads,
locks and debits the `money` wallet". That has not been true since
`20260730100000`: the method now charges MHC through the scoped-price primitive
and, as the protected suite asserts, the file contains no
`debitWalletInTransaction` and no `FROM wallets` at all. The behaviour is
correct; only the comment is wrong. A wrong comment in a money path is the kind
of thing a future reader trusts, so it is worth correcting even though it
changes nothing at runtime.

**F2 — `validate:i18n` does not validate what its name implies.** The script
checks a fixed list of seven legacy snippets and scans for mojibake. It performs
no key-parity comparison, so it would have passed unchanged had a Wave 2 key
been added to `en` and omitted from `ar`. Parity was verified separately for
this audit (1692/1692, zero gaps), but the guard rail does not exist in CI.
Extending the script to flatten both dictionaries and diff the key sets would
make the property continuously enforced instead of periodically audited.

**F3 — Evidence with neither a label nor an original filename renders a raw
UUID.** `help-resolution-screen.tsx:1223` falls back to `ev.uploadId` when
`label` is null, and the server-side `label` is itself
`row.label ?? row.original_name`. Reaching this needs both to be null, and the
identifier is not a secret — the viewer already needs it to open the file, and
the read is reauthorized server-side. It is a presentation blemish, not a leak.
A generic "Attachment" fallback would close it.

**F4 — `docs/release/KNOWN_LIMITATIONS.md` is stale.** It is dated 2026-07-28
against baseline `f7fda17` and predates all four delivered waves, so it does not
carry the Wave 2G-B deferral, the advertisement delivery-semantics boundary, or
the reserved-permission split. Those are all documented accurately elsewhere
(`ADVERTISEMENT_BILLING.md`, `BUSINESS_TEAMS_AND_INVITATIONS.md`,
`WAVE_2GH_BACKEND_BLOCKERS.md`, `WAVE_2_GH_TEAM_UI_CONTRACT.md`), so nothing is
undocumented — but the file that reads like the launch limitations index no
longer is one.

---

## Deferred Wave 2G-B architecture

Deferred honestly, documented in three places, and enforced rather than merely
described:

- **Workspace-wide delegated services, jobs, analytics, bookings,
  advertisements, plans, wallet and financial authority.** Six of the seven
  storable workspace permissions name exactly this work. All six are reported as
  *reserved*, never as effective, and `hasPermission` does not count them. The
  reason is structural: every one of those domains keys its rows to an account
  id that is simultaneously the financial actor, so delegating them requires a
  workspace principal separable from the account that registered it.
- **Ownership transfer.** Blocked on the same prerequisite.
  `business_teams.business_id` is immutable by trigger, and every service, job,
  advertisement, booking, subscription, wallet balance and ledger row in the
  workspace is keyed to it. Moving the Owner membership would produce two
  principals — one holding team administration and believing they own the
  business, one still holding every asset and every charge. The endpoint refuses
  with a stable code rather than offering split authority under the name
  "ownership".
- **Seat commerce.** `DEFAULT_TEAM_SEAT_CEILING` is a technical anti-abuse
  ceiling, not a commercial tier. Launch sells no team seats and no plan
  configures `maxTeamSlots`.
- **Reservation-dispute settlement** stays outside the generic resolver, by
  design, for as long as that path is the one that moves money.
- **Advertisement pricing** remains 0 MHC. The mechanism to charge is complete
  and proven; setting a price is a deliberate admin decision, and three separate
  migrations assert that no migration is what changes it.

Nothing in the deferred set is presented to a user as available.

---

## Final verdict

**APPROVED_WITH_NON_BLOCKING_FOLLOWUPS**

Wave 2 is accepted for launch. All four follow-ups are documentation or
guard-rail improvements; none changes runtime behaviour, and none needs to land
before launch.
