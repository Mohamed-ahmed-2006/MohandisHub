# 03 — Financial and MHC Audit

---

## 1. Does the launch product need a cash wallet at all?

**No.**

The launch model is: customer posts free → provider pays MHC → parties transact directly off-platform. Under that model there is no moment at which MohandisHub holds job money. The only real-money flow is **provider → MohandisHub, to buy MHC**, and that is already handled by `deposit_requests` with `purpose = 'credit_purchase'` — it does not need a wallet balance, because the credits land directly in the `provider_credit` account.

Migration `20260728160000` already acted on this conclusion:

```sql
UPDATE public.wallets SET is_frozen = true WHERE account_type = 'money';
```

Every EGP money wallet in production is frozen. The cash wallet is therefore not "possibly unnecessary" — it is **already switched off at the data layer**, and the remaining work is to stop showing and depending on it.

**Recommendation:** retain all EGP wallet *code and data* (audit trail, historic balances, reversal capability), remove every customer-facing EGP surface, and make each remaining server route fail closed with an explicit `410 Gone`-style error, following the pattern already established by `payBid`.

---

## 2. Confirmed contradictions

### 2.1 Header balance pill shows a frozen EGP balance to every role — **P0**

`apps/web/components/app/app-shell.tsx:208-222`:

```tsx
<span className="app-topbar-balance-label">{dictionary.wallet.balance}</span>
<span className="app-topbar-balance-amount">
  {wallet != null ? `${wallet.balance.toFixed(2)} ${wallet.currency}` : '-'}
</span>
```

`useWallet` calls `GET /api/wallet/me`, which returns the **money** wallet. Rendered for all four roles, with label "Balance". Meanwhile the MHC balance — the only spendable asset at launch — has **no header presence at all** and lives inside `/app/profile`.

The `+` button next to it opens `WalletDepositModal`.

### 2.2 The `+` opens a deposit modal with zero methods — **P0**

`wallet-deposit-modal.tsx:41`:

```ts
const canDeposit = !depositsPaused &&
  (!cryptoDisabled || !cardDisabled || instapayDepositAllowed || paymobDepositAllowed);
```

All four flags are `false` after `20260728160000`. The modal opens and renders:

> "No deposit methods are currently available."

The modal handles the empty case gracefully — it does not crash. But it is reachable from a permanent header button on every screen, which is a dead action, not an edge case. **The fix is to remove the entry point, not to improve the empty state.**

### 2.3 Customers see wallet concepts that do not apply to them — **P0**

`getVisibleProfileSections()` (`profile-screen-sections.ts:17`) returns the `wallet` section unconditionally:

```ts
if (section.id === 'account' || section.id === 'preferences' || section.id === 'wallet') return true;
```

A customer has no wallet function at launch: cannot deposit, cannot withdraw, cannot pay in-platform, cannot hold MHC (MHC is provider-only, enforced in `MhcService`). The section is pure noise, and worse, it implies the platform holds the customer's money — which sets a false expectation about dispute outcomes.

### 2.4 Withdrawal surfaces persist — **P0**

`wallet-settings-screen.tsx:79`:

```ts
const canWithdraw = authUser?.role ? canRequestWithdrawal(authUser.role) : false;
```

`canRequestWithdrawal` returns `true` for all four roles. `anyWithdrawMethod` is false so the *form* is suppressed — but `loadData()` still calls `walletApiClient.listWithdrawals()` when `canWithdraw`, and the withdrawal **section, heading and history list still render**. `formatStatus()` (lines 29-48) exists solely to label states of a feature nobody can use, in hardcoded English.

The five withdrawal-method state variables, quote polling, and verification-code flow are all still mounted.

### 2.5 Advertisements are priced in EGP and debit a frozen wallet — **P0, functionally broken**

`advertisements.service.ts:41-77`:

```ts
const amount = Math.max(0, controls.pricePerDay * input.durationDays);
const wallet = await this.walletRepo.findByUserId(userId);
...
const paymentTxId = await this.walletRepo.debitWalletInTransaction(client, wallet.id, userId, amount, ...);
```

`advertisement_plans.currency DEFAULT 'EGP'`, seeded at 150 EGP for 7 days.

Because the money wallet is frozen, **any ad with a non-zero price fails**. The default `pricePerDay` is `0`, so ads currently work *only* because they are free. The moment an admin sets a price, ad creation breaks.

`mhc_action_prices` already contains an `advertisement` key. It is never read.

### 2.6 Plan subscriptions debit the same frozen wallet — **P0, functionally broken**

`PlansService` takes `WalletRepository` in its constructor (`plans.service.ts:34`) and `SubscribeToPlanResponse` returns `walletBalance`. Any priced plan is unsubscribable.

### 2.7 MHC is not applied consistently

| Action key seeded in `mhc_action_prices` | Charged by code? |
|---|---|
| `award_activation` | ✅ `mhc.service.ts:636` |
| `booking_activation` | ✅ `mhc.service.ts:931` |
| `subscription_upgrade` | ❌ |
| `advertisement` | ❌ |
| `service_promotion` | ❌ |
| `featured_provider` | ❌ |
| `promoted_proposal` | ❌ |
| **`bid_submission`** | **does not exist** |

Two of eight intended revenue points are wired.

### 2.8 There is no bid-submission fee — **P1, missing revenue**

`POST /api/needs/:needId/bids` → `needsController.createBid` → `NeedsService.createBid`. The path enforces email verification, KYC (`requireVerified`), and plan quotas (`new_bids_per_period`, `maxActiveBids`). **It never touches MHC.**

Step 3 of the product objective — "Providers submit proposals using MHC platform credits" — is unimplemented.

---

## 3. What is genuinely well built

This deserves to be recorded, because the safe plan depends on not disturbing it.

### 3.1 Idempotency is structural, not procedural

```sql
CREATE UNIQUE INDEX uq_mhc_activation_award
  ON public.mhc_job_activations(bid_id)
  WHERE activation_type = 'award' AND bid_id IS NOT NULL;
```

A duplicate activation cannot be inserted. Retries, double-clicks and concurrent requests collide on a database constraint rather than on application logic. `mhc.activation-race.test.ts` exercises this.

### 3.2 Payment and unlock cannot diverge

The activation row is written **in the same transaction** as the MHC debit (`MhcRepository.chargeActivation`). `ActivationGateService` then defines "unlocked" as "an activation row exists". There is no separate `is_unlocked` flag that could drift.

### 3.3 The gate fails closed

```ts
// Fail-CLOSED on a missing settings row: the gate stays ON so we never
// accidentally give away contact details because config is absent.
return rows[0]?.enabled !== false;
```

### 3.4 Retired rails fail closed, explicitly

`isPaymentMethodEnabledStrict` exists specifically because `isPaymentMethodEnabled` is fail-open for unknown keys, and a settings row predating a key would otherwise silently re-open a retired money rail. `payBid` uses the strict variant and returns `410 ESCROW_PAYMENTS_RETIRED`.

**This is the deprecation pattern to copy for every other retired surface.**

### 3.5 Disclosure is audited

`provider_payment_disclosures` records `(activation_id, provider_user_id, customer_user_id, disclosed_at)` with a unique constraint. If a provider later claims their bank details leaked, there is a record of exactly which activation disclosed them and to whom.

### 3.6 MHC is never presented as money

`formatMhc()` refuses to attach a currency symbol, with the reasoning in the source. `formatPackagePrice()` is the only money formatter, used only for the real purchase price. This is tested in `mhc-presentation.test.ts`.

---

## 4. Safe deprecation plan for EGP wallet code

**Never delete financial code.** Every step below is reversible.

### Stage 1 — Remove entry points (frontend only, no schema change)

| Change | File |
|---|---|
| Replace header EGP pill with an MHC pill for provider workspaces; render nothing for customers | `app-shell.tsx` |
| Remove the `+` deposit button and `WalletDepositModal` mount | `app-shell.tsx` |
| Drop `wallet` from `getVisibleProfileSections()` for customers | `profile-screen-sections.ts` |
| Remove the withdrawal section entirely (form, history, `formatStatus`) | `wallet-settings-screen.tsx` |
| Route `/app/settings/wallet` → MHC credits screen for providers; `404` for customers | `app/[locale]/app/settings/wallet/page.tsx` |
| Add an MHC entry to the sidebar for provider workspaces | `app-sidebar.tsx`, `MANAGED_SIDEBAR_HREFS` |

**Rollback:** revert the commit. No data touched.

### Stage 2 — Fail-closed the server routes

Apply the `payBid` pattern to every retired route. Do not delete handlers.

```ts
// wallet.service.ts — at the top of each retired operation
if (!isPaymentMethodEnabledStrict(status.paymentMethodsEnabled, 'deposit_instapay')) {
  throw new HttpError({
    statusCode: 410,
    code: 'DEPOSITS_RETIRED',
    message: 'Wallet deposits are no longer available. Providers purchase MHC credits instead.',
  });
}
```

Routes to fence: `POST /wallet/deposit/checkout`, `/wallet/deposits/instapay`, the three legacy deposit aliases, `POST /wallet/withdrawals` and its `cancel`/`verify` siblings, `GET /wallet/withdrawals/quote`.

Routes to **keep open**: `GET /wallet/me`, `GET /wallet/me/transactions`, `GET /wallet/me/transactions/:id/receipt` — providers and admins still need the historic ledger, and admin money-audit tooling reads it.

Webhooks (`/api/wallet/nowpayments/ipn*`, `/api/wallet/paymob/webhook`) must stay live: an in-flight deposit from before the freeze may still settle, and dropping the IPN would strand it.

### Stage 3 — Move ads and plans onto MHC

**Ads:**

```ts
// replace walletRepo.debitWalletInTransaction with:
await this.mhcService.chargeAction({
  userId,
  actionKey: 'advertisement',
  referenceType: 'advertisement',
  referenceId: ad.id,
  client,                       // same transaction
  idempotencyKey: `ad:${ad.id}`,
});
```

Price comes from `mhc_action_prices.advertisement`, not from `advertisement_plans.price`. Keep `advertisement_plans` for duration/placement metadata; ignore its `price`/`currency` columns and add a comment marking them legacy.

**Plans:** remove `WalletRepository` from `PlansService`. Either charge `subscription_upgrade` in MHC, or make launch plans free-with-entitlements and hide the priced path. Whichever is chosen, `SubscribeToPlanResponse.walletBalance` must stop being an EGP figure.

**Every new MHC charge needs:** a unique `idempotencyKey`, execution inside the caller's transaction, a `transactions` ledger row, and a partial unique index preventing a second charge for the same reference. Model it on `mhc_job_activations`.

### Stage 4 — Only after a full billing period with no reversals

Consider archiving `withdrawal_requests` rows and marking legacy columns with SQL comments. **Do not drop tables.** Historic financial records must survive.

---

## 5. Proposed MHC monetisation

### 5.1 Two-fee structure and the balance between them

The brief asks whether proposal fee + activation fee together become too expensive. The answer depends on the ratio, and the ratio should be set from one principle:

> **The bid fee is a quality filter. The activation fee is the revenue.**

If the bid fee is high enough to be a revenue line, providers bid less, customers get fewer proposals, and the marketplace's core value — choice — degrades. Concretely:

- **Bid fee: low.** Enough that spraying 50 identical bids is uneconomic; low enough that a considered bid on a good match is an easy decision. A single-digit MHC figure against a package that buys dozens of bids.
- **Activation fee: the real price.** The provider has *already won*. Their willingness to pay is at its maximum, and the fee is a known cost against a known job.

Suggested ratio: **activation ≈ 10–20× the bid fee.** Both must remain admin-configurable in `mhc_action_prices` — the schema already supports this and no value should be hardcoded.

### 5.2 Guard rails to add alongside the bid fee

The bid fee introduces a new failure mode: a provider pays to bid on a need the customer never intended to award. Mitigations, in order of importance:

1. **Refund the bid fee when the customer never awards anyone** and the need expires or is cancelled. Without this, customers can (intentionally or not) farm bid fees.
2. **Do not refund on a normal loss.** Losing to a better bid is the market working.
3. **Free re-bid on the same need** if the provider edits an existing bid. Charging per edit punishes responsiveness.
4. **Show the fee before submission**, with the current balance and the resulting balance.
5. **Cap bids per need** (`maxBidsPerNeed` already exists in `PlanLimits`) so late bidders are not charged for a proposal the customer will never read.

### 5.3 Recommended launch revenue points

| Point | Action key | Status |
|---|---|---|
| Bid submission | `bid_submission` | **Build** |
| Award activation | `award_activation` | ✅ exists |
| Booking activation | `booking_activation` | ✅ exists |
| Provider / business plans | `subscription_upgrade` | Migrate off EGP |
| Advertisements | `advertisement` | Migrate off EGP |
| Profile spotlight | `featured_provider` | Seeded, unwired |
| Promoted proposal | `promoted_proposal` | Seeded, unwired — **defer**, see below |
| PDF / BoQ export | new key | P2 |
| Extra team seats | new key | P2, needs teams first |

**Deprioritise `promoted_proposal` for launch.** Paying to appear above other bids on a marketplace this young degrades the customer's comparison experience, which is the one thing that must feel trustworthy first. Revisit once bid volume per need is consistently high.

### 5.4 Do not build percentage commission

Correctly avoided already. Since payment happens off-platform, any commission would depend on **self-reported project value** — which is unverifiable and creates a direct incentive to under-report. The activation-fee model deliberately sidesteps this and should not be reopened.

---

## 6. Cashback and retention incentives

The rule from the brief is right and should be enforced structurally: **a reward requires a verified platform event, never a self-reported one.**

| Trigger | Verifiable? | Reward safe? |
|---|---|---|
| "I completed the project" (one party) | ❌ | ❌ Never |
| Both parties mark a milestone complete | ✅ two-sided | ✅ |
| Customer approves a deliverable | ✅ recorded action | ✅ |
| Both parties confirm project completion | ✅ two-sided | ✅ |
| Review submitted after mutual completion | ✅ | ✅ small |
| Provider uploads a file | ❌ trivially farmed | ❌ |

### Fraud and farming risks — per incentive

**Mutual completion reward.** Two colluding accounts run fake projects and harvest MHC. Mitigations: require the activation fee to have been paid (so the loop costs more than it returns — **this alone makes the attack unprofitable if the reward is strictly less than the activation fee**); require distinct verified identities; require a minimum elapsed time; cap rewards per counterparty pair per period; flag repeated pairings for review.

**Review reward.** Fake reviews for credit. Mitigations: reward only reviews on completed, activated jobs; one reward per job; freeze the reward if the review is reported and upheld; never reward the *rating value*, only the act.

**Deliverable-approval reward.** Empty deliverables approved instantly. Mitigations: reward on project completion only, not per deliverable; require a minimum interval between submission and approval.

**Non-negotiable invariant:** *total MHC rewarded per job must be strictly less than the MHC charged for that job.* If it is not, the platform pays users to transact and the ledger becomes an arbitrage. Enforce this with a check in the reward service and a test.

---

## 7. Ledger integrity requirements

Any new credit operation must satisfy all of:

1. **Idempotent** — a partial unique index on the natural key, exactly like `uq_mhc_activation_award`.
2. **Transactional** — debit and effect in one transaction, sharing the caller's `client`.
3. **Race-safe** — `SELECT … FOR UPDATE` on the credit wallet row before the balance check.
4. **Audited** — a `transactions` row with `reference_type` and `reference_id`.
5. **Non-negative** — a DB-level constraint, not only an application check.
6. **Reversible only by audited adjustment** — `type = 'adjustment'`, super-admin only, reason recorded. Never `UPDATE wallets SET balance = …`.

`MhcRepository.chargeActivation` already meets all six. It is the reference implementation; new charge paths should be written by extending it rather than by writing a parallel one.
