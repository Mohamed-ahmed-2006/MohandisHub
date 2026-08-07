# Wave 3 Advertisement Ownership Report

Additive re-association of Advertisement ownership onto the Commercial Identity
spine — the first asset-ownership slice after the BCI foundation.

---

## 1. Verdict

**ADVERTISEMENT OWNERSHIP SLICE COMPLETE**

Business advertisements are owned by the Business Commercial Identity that owns
them, anchored through the authoritative legacy map and through nothing else.
Personal provider advertisements are untouched and keep working. No advertisement
was re-keyed, no historical column moved, and every asset-mixing failure the
slice is meant to prevent is refused by a database key rather than by a code
path.

Two PostgreSQL-gated tests fail, both pre-existing and both environmental — see
§14. Neither involves advertisement ownership.

---

## 2. Base and Branch

|                |                                                                        |
| -------------- | ---------------------------------------------------------------------- |
| Worktree       | `D:\Private Projects\MohandisHub-wave3-final`                          |
| Branch         | `claude/wave3-advertisement-ownership`                                 |
| Base commit    | `ebe972c4ffaf89d29db212492a4d2ef3a20263f2`                             |
| Base migration | 104 — `20260806090000_business_commercial_identity_compatibility.sql`  |
| New migration  | 105 — `20260807090000_advertisement_commercial_identity_ownership.sql` |

---

## 3. Architecture Requirements

Read from the advertisement/asset-ownership sections only:

| Source                                                                  | Requirement                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [09 §4.1](../architecture/wave-3/09-business-buying-and-providing.md)   | Advertisements are **user-owned today**, keyed to an account id that is simultaneously the financial actor. The Business-role user account is a legacy surrogate, not a BCI.                                                                                                                                           |
| [09 §4.4](../architecture/wave-3/09-business-buying-and-providing.md)   | Commercial assets are re-associated **non-destructively**, through compatibility mappings or **additive owner columns** — never by destructive re-keying. The immutable Business-account relationship remains the compatibility anchor for the duration. **One owner may control multiple BCIs without asset mixing.** |
| [09 §4.4](../architecture/wave-3/09-business-buying-and-providing.md)   | "Advertisements migrate on the same additive terms… existing campaigns, periods and renewal state stay readable throughout."                                                                                                                                                                                           |
| [00 §14.1](../architecture/wave-3/00-overview-and-terminology.md)       | Advertisement ownership migrates additively to **PCI/BCI**. Existing free machinery stays operational; pricing is not a prerequisite.                                                                                                                                                                                  |
| [16 §1.12 H4](../architecture/wave-3/16-wave-3-scope.md)                | Fence: **advertisements are owned by the correct Commercial Identity** after the ownership migration.                                                                                                                                                                                                                  |
| [16 §1.12 B1/B5](../architecture/wave-3/16-wave-3-scope.md)             | A legacy Business account maps to **exactly one** initial BCI, deterministically; assets stay separate per BCI.                                                                                                                                                                                                        |
| [17 INV-141 / INV-145](../architecture/wave-3/17-product-invariants.md) | Ownership migrates additively without destructive re-keying, and historical advertisement records stay readable.                                                                                                                                                                                                       |
| [09 §4.2](../architecture/wave-3/09-business-buying-and-providing.md)   | Only the verified Business owner performs commercial actions. Membership is consulted **never**. No delegated commercial capability, advertisements explicitly included.                                                                                                                                               |

The controlling rule this slice implements: **the persisted BCI legacy map is the
authoritative anchor for legacy Business-owned assets.** Ownership is never
inferred from `owner_user_id`, because one owner may control several identities
and only one of them inherits that legacy Business's assets.

---

## 4. Legacy Advertisement Ownership Model

Verified from schema and code, not assumed.

| Fact                   | Source                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner column           | `advertisements.advertiser_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` (`20260409123000`)                                                                          |
| Who may advertise      | `expert`, `business`, `craftsman` — `requireRole` on `POST /advertisements`, and `isAdvertisableProvider` re-checks the same three roles. **Never a Customer, never an Admin.** |
| Creator field          | None separate. The advertiser is the creator.                                                                                                                                   |
| Business field         | None. There is no Business/workspace column on `advertisements` at all.                                                                                                         |
| Moderation ownership   | Platform: `reviewed_by`, `reviewed_at`, `rejection_reason`, gated by admin permissions `manage_ads` / `manage_ad_scheduling` / `manage_ad_pricing`.                             |
| Billing ownership      | `advertisement_campaign_periods` keyed to the advertisement; charging calls `chargeAction({ userId: ad.advertiser_id })`.                                                       |
| Renewal ownership      | `advertisement_renewal_events.advertiser_id`, and `auto_renew_enabled_by` (always the advertiser).                                                                              |
| Mutation authorization | `ad.advertiser_id !== userId` → 403 `FORBIDDEN`, in six places across the service, billing service and renewal service.                                                         |
| Read paths             | `listMyAds` filters `advertiser_id = $1`; `listAllAds` (admin) joins `users`; `getAdById` joins `users` for the display name.                                                   |

**Ownership map before this slice**

```
advertisement
  → advertiser_id (users.id)
      ├── primary_role = 'business'   → BCI target: the account's initial BCI
      ├── primary_role = 'expert'     → PCI target (does not exist yet)
      └── primary_role = 'craftsman'  → PCI target (does not exist yet)
  → read path:           advertiser_id
  → mutation authz path: advertiser_id
  → billing path:        advertiser_id (MHC credit wallet)
```

Customer- and Admin-owned advertisements are not a case: no route creates one.

---

## 5. New Commercial Ownership Model

Model **A — a typed commercial identity reference**, chosen because the
architecture requires a design that survives the PCI slice without a second
ownership rewrite, and because a weak `owner_type TEXT` / `owner_id UUID` pair
carries no integrity at all.

Four additive columns on `advertisements`:

| Column                                                                 | Meaning                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commercial_owner_kind TEXT`                                           | Typed discriminator. `NULL` = not migrated, `'business'` = BCI-owned. The PCI slice widens the CHECK and adds a second typed column; that is additive. |
| `business_commercial_identity_id UUID`                                 | The owning BCI.                                                                                                                                        |
| `commercial_ownership_state TEXT NOT NULL DEFAULT 'legacy_user_owned'` | Compatibility phase: `legacy_user_owned`, `commercial_identity_owned`, `quarantined_ambiguous`.                                                        |
| `commercial_ownership_assigned_at TIMESTAMPTZ`                         | When canonical ownership was recorded.                                                                                                                 |

`advertiser_id` is **unchanged and still populated**. It remains the legacy
anchor, the moderation/billing/renewal key, and the account weekly billing
charges.

### The integrity model

```sql
CONSTRAINT fk_advertisements_business_identity_anchor
  FOREIGN KEY (business_commercial_identity_id, advertiser_id)
  REFERENCES public.business_commercial_identity_legacy_map (bci_id, business_account_id)
  ON UPDATE RESTRICT ON DELETE NO ACTION
```

The target is the **legacy map**, not the identity table. Targeting
`business_commercial_identities (id, owner_user_id)` would only prove the
identity belongs to the same person — which a natively created second identity
also does. Targeting the map proves it is the one identity that legacy
Business's assets belong to. Consequently these are all **unrepresentable**,
without a trigger or an application check being involved:

- an advertisement pointing at another Business's identity;
- an advertisement pointing at a same-owner **native** identity (never mapped);
- an advertisement pointing at an identity that does not exist.

Supporting constraints:

- `chk_advertisements_commercial_owner_kind` — the discriminator and the typed
  reference agree in both directions (written with explicit `IS NULL` tests,
  because `(kind = 'business') = (id IS NOT NULL)` evaluates to `NULL` and
  therefore _passes_ when the kind is NULL).
- `chk_advertisements_ownership_state_pairing` — the state agrees with what the
  row actually holds; `commercial_identity_owned` requires an owner and a
  timestamp, and the other two states forbid both.
- `uq_business_commercial_identity_legacy_map_anchor` on the map — added so the
  composite key above has a named target. Logically implied by the existing
  `UNIQUE (bci_id)`, so it is satisfiable by construction.
- `trg_advertisements_immutable_commercial_owner` — an assignment cannot be
  re-pointed or cleared. Wave 3 defines no advertisement reassociation, so the
  database refuses one rather than leaving it to whoever writes the next UPDATE.

RLS: `advertisements` has never carried RLS or a browser-role grant; it is
reached only through the API's service role. The migration issues no `GRANT` and
creates no policy, so the new columns inherit that posture and no browser role
acquires a route to mutate ownership.

---

## 6. Business-to-BCI Backfill

```sql
UPDATE public.advertisements a
   SET commercial_owner_kind            = 'business',
       business_commercial_identity_id  = m.bci_id,
       commercial_ownership_state       = 'commercial_identity_owned',
       commercial_ownership_assigned_at = now()
  FROM public.business_commercial_identity_legacy_map m
 WHERE m.business_account_id = a.advertiser_id
   AND a.business_commercial_identity_id IS NULL
   AND a.commercial_ownership_state = 'legacy_user_owned';
```

- Driven **entirely from the persisted legacy map**. `users` is not joined and
  `primary_role` is not re-derived: the map is the authoritative record of which
  accounts are legacy Business principals, and consulting a second source would
  be a second answer.
- **Idempotent by predicate** — a second run updates nothing, including the
  `assigned_at` timestamp.
- **Concurrency-safe** — the UPDATE takes a row lock per advertisement, and the
  request path stamps the identical value through the identical map lookup, so a
  row written by either is skipped by the other.
- No team, workspace, team member, selected workspace or "first BCI returned" is
  a term anywhere in it.

**Same-owner native BCI behaviour.** A Business A advertisement maps to Business
A's _initial_ BCI and can never reach a native second BCI that A created
afterwards. This is enforced three times over: the backfill reads only the map;
the composite foreign key cannot reference an unmapped identity; and the
migration's reconciliation asserts `origin <> 'legacy_business_account'` yields
zero rows.

---

## 7. Personal Provider Compatibility

Expert and Craftsman advertisements are **left exactly where they are**:
`commercial_owner_kind IS NULL`, `business_commercial_identity_id IS NULL`,
`commercial_ownership_state = 'legacy_user_owned'`, `assigned_at IS NULL`.

- No PCI is invented, and no PCI table, column or type is created anywhere in
  the slice.
- No fake BCI is minted for a personal provider.
- No personal provider account is silently reinterpreted as a Business.
- Their reads, authorization and billing are byte-for-byte what they were.

A **Business account with no mapping row** — one registered after the spine
migration ran — resolves the same way, reported as
`no_business_commercial_identity` rather than
`awaiting_personal_commercial_identity`. Fencing its campaign for a gap it did
not cause would be a regression, and the legacy anchor names the same account its
identity would name anyway, so no leak is possible.

---

## 8. Dual-Read / Compatibility Resolution

`apps/api/src/modules/advertisements/advertisement-ownership.repository.ts`

```
1. canonical commercial identity, when the row carries one
     → validate: identity exists
                 identity owner == advertiser
                 identity is anchored to THIS advertiser in the map
                 the advertiser's anchor is THIS identity
                 the id is the deterministic initial id for the advertiser
                 the identity declares legacy origin
     → use it                                    (source: 'assigned')

2. otherwise, the identity the LEGACY anchor resolves to
     → the advertiser's authoritative initial BCI, from the map
     → use it                                    (source: 'legacy_compatibility')

3. otherwise, the legacy user owner
     → correct and only available answer for a personal provider
```

Step 2 is **not a fallback for a failed step 1**. A canonical owner that is
present but invalid is a _contradiction_, and a contradiction stops the request.
Falling through there would be the silent substitution this slice exists to
prevent: the row says one thing, the request would act on another.

The ordering also settles the agreement case without a special branch: when the
assigned identity and the legacy anchor name the same BCI — the only shape the
composite key allows — steps 1 and 2 produce the same answer, so "they agree" is
not a state anybody has to detect.

**Contradictory ownership fails closed**, with a named reason:

| Reason                       | Condition                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner_mismatch`             | The assigned identity belongs to a different account.                                                                                                   |
| `non_authoritative_identity` | The assigned identity is not this advertiser's authoritative initial BCI — a same-owner native identity, or an anchor that is not the deterministic id. |
| `unknown_identity`           | The assigned identity does not exist.                                                                                                                   |
| `origin_conflict`            | An anchored identity that does not declare legacy origin.                                                                                               |
| `state_conflict`             | The state column and the ownership columns disagree, in either direction.                                                                               |
| `duplicate_legacy_mappings`  | More than one mapping resolves for this advertiser.                                                                                                     |
| `quarantined`                | Fenced by an operator. Not repairable by a read.                                                                                                        |

`commercialControllerOf()` returns `null` for every one of them, so an ambiguous
advertisement authorizes nobody. The resolver reads the row on every call and
holds no cache, so no earlier answer can be served to a later caller.

`business_members`, `business_team_roles`, `business_team_invites` and the
workspace-selection state appear in neither the resolver nor the gate above it.

---

## 9. Authorization

`apps/api/src/modules/advertisements/advertisement-ownership.authorization.ts`

**Allowed:** the canonical Business account named in
`business_commercial_identities.owner_user_id` for the identity that owns the
campaign.

**Denied — every one of them, because none of them is consulted:**

- an unrelated user;
- a Business team member;
- a member holding `manage_team`;
- a member whose team role is labelled Admin (or stored as `manager`);
- a member carrying any of the six reserved permissions;
- a user who has merely selected that Business's workspace;
- a platform administrator (there is no admin parameter in the gate at all);
- **the same owner acting through a second identity they control** — denied by
  the resolver, which resolves ownership through the authoritative map rather
  than through "an identity this person owns".

Wired into six advertiser-initiated mutations in `advertisements.service.ts`:
`updateAd`, `cancelAd`, `renewAd`, `activateDueAdvertisement` (only when an
advertiser is driving it), `setAutoRenewal`, `retryAutomaticRenewal`.

The gate reproduces the two refusals those routes already return — 404
`AD_NOT_FOUND` for an unknown campaign, 403 `FORBIDDEN` for one that is not
yours — so every request denied before is denied identically now. The only new
response is **409 `AD_OWNERSHIP_AMBIGUOUS`**, for a state that could not
previously exist, and it is shown only to the account the row names as
advertiser; to anybody else a corrupt row is indistinguishable from a campaign
they do not own, which is what it is.

The in-transaction `advertiser_id` re-check inside each locked mutation is
**retained unchanged** as the race-safe last word. The gate refuses earlier, and
refuses what a bare column comparison cannot see.

**Platform moderation is untouched and stays separate.** `admin/:id/approve`,
`reject`, `activate-due`, `status`, `schedule` and `pricing` continue to gate on
`manage_ads` / `manage_ad_scheduling` / `manage_ad_pricing`, re-loaded from the
database per request. None of them passes through the commercial gate, and an
administrator never acquires the Business's commercial authority. The
admin-driven `activateDueAdvertisement` call supplies no `requireAdvertiserId`
and is explicitly not treated as the Business acting.

Legacy personal-provider authorization is preserved exactly: the actor must be
the legacy advertiser, as today.

---

## 10. Billing and Renewal Boundary

**No billing or renewal change was needed, and none was made.**

Charging already targets the advertisement's own stored advertiser —
`chargeAction({ userId: ad.advertiser_id })` — and the composite foreign key now
makes the owning identity's canonical controller _identical to_ `advertiser_id`.
There is therefore no account a cross-identity charge could reach, and no
renewal can run for another BCI: an advertisement cannot name an identity whose
owner is not its own advertiser.

Renewal authorization is no longer reachable from team membership, because the
gate in §9 fronts `renewAd`, `setAutoRenewal` and `retryAutomaticRenewal`.

Explicitly preserved:

- the advertisement action price stays where the admin left it — the migration
  never mentions `mhc_action_prices`;
- no MHC advertisement price is introduced;
- no EGP wallet charging is resurrected — the migration mentions no wallet and
  writes no `amount_paid`;
- period billing and renewal idempotency are untouched.

MHC balance ownership is a later slice; a BCI has no balance of its own today,
which is precisely why billing must keep using the legacy account.

---

## 11. No-Asset-Mixing Guarantees

| Guarantee                                                             | How it is guaranteed                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business A's advertisement never appears as owned by Business B's BCI | Composite FK `(identity, advertiser)` → map `(bci_id, business_account_id)`. Proved against real PostgreSQL: `23503`.                                    |
| A legacy advertisement cannot migrate to a same-owner **native** BCI  | A native identity is never in the legacy map, so the key has nothing to reference. Proved: `23503`. Also asserted by the migration's own reconciliation. |
| A personal provider's advertisement does not become Business-owned    | The backfill's only source is the map, which contains no personal provider. Proved end-to-end.                                                           |
| One identity's advertisements do not leak into another's owner query  | Resolution is per-row and per-read; ownership is never derived from `owner_user_id`.                                                                     |
| Read ordering and caching cannot bleed ownership state                | The resolver holds no cache and issues a query per call; asserted both behaviourally and against the source.                                             |
| An assigned advertisement cannot be re-pointed or unassigned          | `trg_advertisements_immutable_commercial_owner`. Proved: `23514`.                                                                                        |

---

## 12. Migration and Reconciliation

`supabase/migrations/20260807090000_advertisement_commercial_identity_ownership.sql`

Forward-only, additive, retry-safe. Migrations 1–104 are untouched. Every
constraint addition is guarded on `pg_constraint`, because `ALTER TABLE ADD
CONSTRAINT` has no `IF NOT EXISTS` and a migration that cannot replay cannot be
retried after a partial failure.

Before writing anything it fingerprints **every legacy column of every
advertisement** into a temporary table — positionally, via a composite `ROW`
rendering, including `updated_at` (the table carries no updated_at trigger, so a
changed value would mean something wrote a column this migration must not
write). The reconciliation block then refuses to commit unless all of the
following hold:

1. the advertisement count before the backfill equals the count after;
2. the count equals the distinct-id count — nothing duplicated;
3. the legacy fingerprint is byte-identical — no id, billing figure, moderation
   decision, renewal counter or timestamp moved;
4. the number of advertisements whose advertiser has a mapping equals the number
   assigned to a commercial identity;
5. no assigned advertisement points anywhere but at its own advertiser's initial
   BCI;
6. no assigned advertisement points at an identity owned by a different account;
7. no assigned advertisement points at a natively created identity;
8. no assigned advertisement names an identity that does not exist;
9. no advertisement whose advertiser has no mapping received any commercial
   ownership — personal providers are provably untouched;
10. no advertisement carries a state its ownership columns contradict.

Ambiguity is handled by **failing closed**: the backfill assigns only what it can
prove through the map, and `quarantined_ambiguous` exists as an operator fence
for a row that cannot be resolved — resolution refuses it rather than guessing.
On a database migrated from 104 the quarantine population is empty by
construction, which reconciliation check 4 asserts.

Indexes added: `idx_advertisements_commercial_identity` (partial, "everything
this identity owns") and `idx_advertisements_ownership_unresolved` (partial, the
PCI slice's reconciliation query and the operator's quarantine list).

The write path applies the same rule: `stampCommercialOwnerInTx` runs the
identical UPDATE inside the campaign-creation transaction, so a Business campaign
is never briefly visible without its commercial owner and a rollback removes
both together.

---

## 13. Tests

**75 tests added** (50 ordinary, 25 PostgreSQL-gated).

`apps/api/src/tests/advertisement-ownership.test.ts` — 50 ordinary tests

- the migration is additive: rewrites no other commercial asset, writes only to
  `advertisements`, drops no column, renames nothing, never writes
  `advertiser_id`, adds every column nullable-or-defaulted;
- anchors ownership to the persisted map with a key, backfills through the map
  alone, is idempotent by predicate, reconciles itself, refuses reassociation,
  grants no browser role anything;
- resolution: canonical owner, legacy-compatible owner, the two agreeing, the
  unknown advertisement, and no cache;
- **nine** contradiction cases, each asserting both the named reason and that
  `commercialControllerOf` is `null` — no arbitrary fallback;
- personal provider compatibility for Expert, Craftsman, and a Business with no
  mapping; no PCI invented anywhere;
- authorization: allow the canonical controller; deny the unrelated user, team
  member, `manage_team` holder, Admin-labelled member, reserved-permission
  member, workspace selector and platform administrator; deny the same owner
  acting through a second identity; corruption reported only to the advertiser;
  legacy provider authorization preserved; the two existing refusals reproduced;
  membership tables and `hasPermission` absent from the source; no admin bypass;
- no asset mixing: two Businesses stay isolated, in either read order, and
  neither can act on the other;
- the write path reads the map and not `owner_user_id`, and runs in the caller's
  transaction;
- the billing boundary: charging still names `ad.advertiser_id`, the migration
  introduces no price and no wallet.

`apps/api/src/tests/advertisement-ownership.migration.pg.test.ts` — 25 gated tests

Empty table; one Business advertisement; several for one Business; several
Businesses isolated; one owner with several BCIs mapping only to the initial one;
a native identity refused (`23503`); another Business's identity refused
(`23503`); a non-existent identity refused (`23503`); the one legal assignment
accepted; Expert and Craftsman untouched; no identity created for a personal
provider; a Business migrating without disturbing the providers beside it; a
second run assigning nothing; an API-made assignment preserved; re-pointing and
clearing refused (`23514`); a kind without an identity refused; an undefined
owner kind refused; a contradictory state refused; an unknown state refused;
operator quarantine accepted only on an unassigned row; advertisement ids and
count unchanged; every legacy column byte-identical; ownership columns on no
other table; the BCI spine's own rows untouched; a Business account still
deletable.

**Legacy regression.** `advertisements.moderation.test.ts` (39 tests) covers
listing, detail reads, create, edit, cancel, moderation, renewal scheduling and
auto-renewal, and passes unchanged. Its pool fixture gained the ownership row a
correct database returns for an Expert campaign — the assertions are untouched
because the answer is unchanged. `advertisements.weekly-billing.pg.test.ts`,
`advertisements.automatic-renewal.pg.test.ts` and
`advertisement-renewal.worker.test.ts` pass unchanged.

`business-identity.migration.pg.test.ts` gained one line in its rollback script:
the advertisement anchor foreign key is released before the map table is dropped,
because a later migration now names it. Its 24 assertions are unchanged.

---

## 14. PostgreSQL Execution

Executed against a **brand-new disposable local cluster**, created and destroyed
for this validation:

- PostgreSQL 18.4, `initdb` into a scratch data directory outside the repository;
- loopback only (`listen_addresses=127.0.0.1`), temporary port `55433`;
- Supabase compatibility roles `anon`, `authenticated`, `service_role` created;
- `PG_INTEGRATION_URL` supplied per command, never written to a file;
- every migration replayed from zero, 1 → 105, into a fresh scratch database per
  suite;
- cluster stopped and its data directory deleted afterwards.

The persisted workstation cluster was never touched. No staging or production
database was contacted. No credentials were committed or exposed.

**Result: 1014 passing, 2 failing (62 files).**

Advertisement ownership: **25/25 passing** on the advertisement ownership
migration suite, and **48/48** across it together with the BCI spine suite
(`business-identity.migration.pg`), which was re-run because its rollback script
now releases this slice's foreign key.

The two failures are the **known pre-existing PostgreSQL 18 catalog fingerprint
failures**, verified to be the same two and unrelated to this slice:

| Suite                              | Test                                                    | Unexpected catalog entries                                                                                                     |
| ---------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `advertisements.weekly-billing.pg` | reverses the documented rollback to the expected schema | `advertisements_{billing_model,billing_status,renewal_mode,renewal_count,auto_renew_enabled,manual_renewal_required}_not_null` |
| `business-teams.workspace.pg`      | reverses to the exact fingerprint it started from       | `business_team_roles_is_legacy_not_null`                                                                                       |

Every entry is a **NOT NULL constraint on a column introduced by an earlier
wave** (`20260730120000` and `20260731120000`). PostgreSQL 18 records NOT NULL
constraints as named rows in `pg_constraint`; PostgreSQL 17 and earlier do not,
so the schema-fingerprint filters in those two suites do not anticipate them.
None of the six-plus-one names belongs to this slice. The repository's committed
Supabase configuration targets **PostgreSQL 17**, where these do not arise. Not
repaired here — that is a separate task.

Migration 104 is byte-for-byte unchanged and was not re-validated.

---

## 15. Ordinary Validation

| Check                    | Result                                                  |
| ------------------------ | ------------------------------------------------------- |
| `npm test`               | **999 passing** (was 949) — shared 20, api 659, web 320 |
| `npm run typecheck`      | pass (shared, api, web)                                 |
| `npm run lint`           | pass, `--max-warnings=0`                                |
| `npm run validate:i18n`  | pass                                                    |
| `npm run build`          | pass                                                    |
| Prettier (changed files) | clean                                                   |
| `git diff --check`       | clean                                                   |

---

## 16. Known Risks

1. **A Business registered after the spine migration has no BCI.** The BCI slice
   was compatibility-only and mints no identity at runtime, so such an account's
   advertisements resolve as `legacy_user_owned` /
   `no_business_commercial_identity`. Authorization is exactly as strict as
   today (the legacy advertiser is the same account the identity would name), so
   no leak is possible — but the population is not zero forever, and the next
   slice that mints identities at signup should re-run the same idempotent
   backfill. `idx_advertisements_ownership_unresolved` exists to find them.

2. **BCI status is carried, not gated.** A suspended or archived commercial
   identity does not currently block an advertisement action. Wave 3 attaches no
   advertisement consequence to identity status, and inventing one here would be
   enforcement design belonging to the suspension slice. The status is returned
   on the resolved context so that slice can gate it in one place.

3. **A future advertisement reassociation will need a constraint relaxation.**
   The composite key and the immutability trigger deliberately forbid pointing an
   advertisement at anything but its advertiser's initial BCI. If architecture
   later defines a reassociation operation, it must widen the key — a forward,
   additive schema change, not an ownership rewrite.

4. **Reads were deliberately not gated.** `getBillingState` and
   `listPeriodHistory` keep today's owner-or-admin check. Failing a read closed on
   an ambiguous row would block the very operator who has to reconcile it.
   Mutations are gated; reads are not.

---

## 17. Explicitly Deferred Scope

Not implemented, and no partial scaffolding for any of it exists in this branch:

PCI implementation, PCI migration, PCI conversion; Expert/Craftsman identity
migration beyond the advertisement compatibility state; Services, Plans,
Subscriptions, Wallets, MHC balance and Jobs ownership migration; Engagements,
Offers, Proposals, Orders; settlement, fulfillment, verified GMV, monthly rent;
business ownership transfer; delegated commercial authority; workspace-owned
assets; BCI or PCI switcher; cross-identity analytics; advertisement pricing,
renewal or moderation redesign; any frontend identity surface.

No Wave 2 advertisement billing decision was reopened — no incompatibility with
Wave 3 ownership was found.

---

## 18. Recommended Next Wave 3 Slice

**Services ownership re-association onto the Commercial Identity spine.**

The compatibility pattern this slice establishes — additive typed columns, a
composite foreign key targeting the legacy map, a dual read that prefers the
canonical owner and fails closed on contradiction, and a gate that resolves
authority through the identity — transfers directly. `services.provider_id`
carries the same legacy shape as `advertisements.advertiser_id` and the same
mixed Business/Expert/Craftsman population, so the same staged answer applies:
Business services re-associate now, personal providers wait for the PCI.

Doing Services next also unblocks the destination integrity that advertisements
already depend on (`destination_service_id`), keeping asset ownership consistent
across the two objects a campaign can point at.

The **Personal Commercial Identity spine** is the alternative, and is the harder
prerequisite for everything still marked `awaiting_personal_commercial_identity`.
Services first is the lower-risk order: it proves the pattern a second time on a
population this slice has already characterised, before the PCI introduces a new
principal.
