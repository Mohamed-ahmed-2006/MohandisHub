# MohandisHub — MHC Tiered Pricing Implementation Prompt

## Role

Act as a senior backend architect and product engineer working inside the MohandisHub codebase.

Your task is to design and implement a tiered MHC purchasing system where:

- MHC is a universal, fungible platform credit.
- Every MHC coin behaves identically after purchase.
- Providers can use MHC for bidding, advertising, boosts, promotions, or future platform features.
- The platform does not need to know where purchased MHC will eventually be spent.
- The EGP price of newly purchased MHC depends on the provider's commercial tier.
- Existing MHC must never be repriced when a provider's tier changes.
- Existing balances must remain valid and spendable.
- Provider tier changes affect future purchases only.

Do not implement project-specific bid pricing. A bid may remain fixed at 20 MHC regardless of provider tier.

---

# 1. Core Pricing Model

Use the following equation:

\[
\text{MHC Purchase Price}
=
Q \times R_0 \times M_t \times (1-D_Q)
\]

Where:

- \(Q\) = purchased MHC quantity.
- \(R_0\) = base EGP price per MHC.
- \(M_t\) = multiplier for the provider's current pricing tier.
- \(D_Q\) = package-size discount.

Initial configurable base rate:

\[
R_0 = 2\ \text{EGP per MHC}
\]

Initial tier multipliers:

| Tier         | Multiplier | Effective EGP/MHC |
| ------------ | ---------: | ----------------: |
| Launch       |       0.50 |              1.00 |
| Starter      |       0.75 |              1.50 |
| Growth       |       1.00 |              2.00 |
| Professional |       1.50 |              3.00 |
| Enterprise   |       2.00 |              4.00 |

These values must not be hard-coded across the codebase. Store them in centralized configuration or an admin-controlled pricing table.

---

# 2. Provider Commercial Score

Create a Provider Commercial Score, named `providerCommercialScore` or `PCS`, ranging from 0 to 100.

Use activity from the previous rolling 90 days.

\[
PCS = 50V + 20J + 15U + 10B + 5C
\]

All component values must be normalized between 0 and 1.

## 2.1 Adjusted Commercial Value

\[
V =
\min\left(
1,
\frac{\ln(1+A\_{90})}{\ln(1+200000)}
\right)
\]

Where:

\[
A*{90}
=
\sum_i
\left(
\text{Award Value}\_i
\times
K*{\text{category},i}
\right)
\]

Initial category coefficients:

| Category type                         | Coefficient |
| ------------------------------------- | ----------: |
| Pure consultation or digital service  |        1.00 |
| Design or engineering service         |        0.90 |
| Labor-heavy maintenance               |        0.75 |
| Mixed labor and materials             |        0.55 |
| Material-heavy construction or supply |        0.35 |

Category coefficients must be configurable.

Use completed transaction value where reliable.

If the current platform does not yet track verified completion value reliably, use awarded value as the temporary fallback, but clearly isolate this fallback so it can be replaced later.

## 2.2 Completed Jobs

\[
J =
\min\left(
1,
\frac{\text{Completed Jobs in 90 Days}}{20}
\right)
\]

## 2.3 MHC Consumption

\[
U =
\min\left(
1,
\frac{\text{MHC Spent in 90 Days}}{2000}
\right)
\]

## 2.4 Business Scale

Use:

| Provider structure                    |    B |
| ------------------------------------- | ---: |
| Unverified individual                 | 0.00 |
| Verified individual professional      | 0.25 |
| Verified office                       | 0.60 |
| Registered company or multi-user team | 1.00 |

## 2.5 Completion Reliability

\[
C =
\frac{\text{Completed Awarded Jobs}}{\text{Total Awarded Jobs}}
\]

Rules:

- Clamp the value between 0 and 1.
- If there are no awarded jobs, use 0.
- Do not use customer ratings as a direct pricing factor.

---

# 3. Tier Assignment

Use these thresholds:

|                           PCS | Tier         |
| ----------------------------: | ------------ |
| Special temporary eligibility | Launch       |
|                          0–34 | Starter      |
|                         35–59 | Growth       |
|                         60–79 | Professional |
|                        80–100 | Enterprise   |

## 3.1 Launch Eligibility

Launch is not assigned only by PCS.

A provider is Launch-eligible only if all of the following are true:

- Account age is no more than 60 days.
- Identity and phone verification are complete.
- Lifetime Launch-rate MHC purchases do not exceed 400 MHC.
- No linked previous provider account has already received Launch eligibility.
- No fraud or abuse flag blocks promotional pricing.

Launch purchase limits:

- Maximum 200 MHC per calendar month.
- Maximum 400 MHC over the lifetime of the account.
- Maximum wallet balance of 400 MHC while using Launch pricing.

After 60 days or 400 lifetime Launch MHC purchases, move the provider to at least Starter.

---

# 4. Tier Review Rules

Implement a monthly tier recalculation process.

Rules:

- Recalculate PCS once per month.
- New tiers affect future MHC purchases only.
- Existing MHC balances remain unchanged.
- Existing purchased MHC remains fully spendable.
- Existing MHC must not require a top-up.
- Upgrades may take effect at the next monthly review.
- Downgrades require two consecutive monthly scores below the current tier threshold.
- A provider may move down by no more than one tier per monthly review.
- Notify the provider before a price increase when notification infrastructure supports it.
- Preserve a tier history for auditing.

Do not change pricing after every single job or wallet transaction.

---

# 5. MHC Purchasing Limits

Initial limits:

| Tier         |       Monthly purchase ceiling | Recommended wallet ceiling |
| ------------ | -----------------------------: | -------------------------: |
| Launch       |          200 MHC, 400 lifetime |                    400 MHC |
| Starter      |                      1,000 MHC |                  1,500 MHC |
| Growth       |                      3,000 MHC |                  5,000 MHC |
| Professional |                     10,000 MHC |                 15,000 MHC |
| Enterprise   | Configurable or contract-based |               Configurable |

Clarify in code and UI that purchase ceilings are separate from wallet ceilings.

A provider cannot buy more MHC when the resulting balance would exceed the wallet ceiling.

Do not remove already owned MHC if a tier change causes the provider's wallet to exceed the new ceiling. Block only new purchases until the balance falls below the ceiling.

---

# 6. Package Discounts

Initial package discounts:

| Purchased quantity | Discount |
| -----------------: | -------: |
|            100 MHC |       0% |
|            300 MHC |       3% |
|          1,000 MHC |       5% |
|          3,000 MHC |       7% |
|         10,000 MHC |      10% |

Rules:

- Maximum discount is 10%.
- Validate that a package is allowed under the provider's tier purchase ceiling.
- Package discounts apply after the provider tier multiplier.
- Avoid floating-point currency errors.
- Use integer minor units, such as piastres, for financial calculations.

Example:

A Professional provider buying 1,000 MHC:

\[
1000 \times 2 \times 1.5 \times (1-0.05)
=
2850\ \text{EGP}
\]

---

# 7. Automatic Overrides

Use PCS as the main mechanism, but support explicit override rules.

Automatically assign at least Professional for the next review period when any of these conditions are met:

- Adjusted commercial value exceeds 150,000 EGP over 90 days.
- More than 15 awarded jobs occur within 30 days.
- The account is a verified multi-user office.
- The provider manages multiple team members.
- The provider consumes unusually large MHC volumes according to configurable thresholds.

Mark for Enterprise review when any of these conditions are met:

- Adjusted commercial value exceeds 300,000 EGP over 90 days.
- The provider is a registered company.
- More than five team members belong to the provider organization.
- The provider requests bulk marketplace advertising or enterprise features.

Manual administrator overrides must include:

- Reason.
- Administrator ID.
- Effective date.
- Optional expiry date.
- Audit-log entry.

Manual overrides must not silently destroy historical score data.

---

# 8. Wallet and Ledger Rules

MHC must remain fungible.

The provider sees one total wallet balance.

Internally, use a proper append-only ledger.

Every MHC balance change must create a ledger transaction.

Required transaction categories should include at least:

- Purchase.
- Bid spend.
- Advertising spend.
- Boost spend.
- Promotional credit.
- Refund.
- Reversal.
- Administrative adjustment.
- Expiration of bonus MHC, if bonus expiration is introduced.
- Migration adjustment.

Never update the balance without a corresponding ledger record.

The wallet balance should either:

1. Be derived from the ledger, or
2. Be stored as a cached balance protected by a database transaction and reconciliation checks.

Prevent race conditions and double spending.

Use idempotency keys for payment completion and wallet crediting.

---

# 9. Paid MHC and Bonus MHC

Support separate accounting classifications even if the UI initially displays a combined total.

## Paid MHC

- Purchased using EGP.
- Usable across all eligible MHC features.
- Should not expire under normal policy.
- Remains valid after tier changes.

## Bonus MHC

- Welcome rewards.
- Referral rewards.
- Promotions.
- Compensation.
- Administrative grants.

Bonus MHC may support:

- Expiry.
- Feature restrictions.
- Non-transferability.
- Separate consumption priority.

Do not mix paid and bonus MHC in a way that prevents accurate refunds, reporting, or auditing.

Define a deterministic spending order, such as:

1. Bonus MHC closest to expiration.
2. Other bonus MHC.
3. Paid MHC.

Make the policy configurable.

---

# 10. Suggested Data Model

Adapt names to the existing schema and conventions.

## Provider Pricing State

Suggested fields:

```ts
providerTier;
providerCommercialScore;
tierEffectiveAt;
tierLastCalculatedAt;
tierBelowThresholdSince;
manualTierOverride;
manualTierOverrideExpiresAt;
launchMhcPurchasedLifetime;
monthlyMhcPurchased;
monthlyPurchasePeriod;
walletLimit;
pricingVersion;
```

## Tier History

Suggested fields:

```ts
id;
providerId;
previousTier;
newTier;
previousScore;
newScore;
reason;
calculationBreakdown;
effectiveAt;
createdAt;
```

## MHC Purchase

Suggested fields:

```ts
id;
providerId;
mhcQuantity;
pricePerMhcMinor;
subtotalMinor;
discountRate;
discountAmountMinor;
totalPaidMinor;
currency;
tierAtPurchase;
providerScoreAtPurchase;
pricingVersion;
paymentReference;
idempotencyKey;
status;
createdAt;
completedAt;
```

## Wallet Ledger

Suggested fields:

```ts
id;
providerId;
transactionType;
paidMhcChange;
bonusMhcChange;
totalMhcChange;
balanceAfter;
referenceType;
referenceId;
idempotencyKey;
metadata;
createdAt;
```

## Pricing Configuration

Suggested fields:

```ts
pricingVersion;
baseRateMinor;
tierMultipliers;
tierThresholds;
packageDiscounts;
monthlyPurchaseLimits;
walletLimits;
launchRules;
categoryCoefficients;
overrideThresholds;
effectiveFrom;
effectiveTo;
isActive;
```

Store enough pricing context on every purchase so historical transactions remain reproducible even after pricing configuration changes.

---

# 11. API and Service Requirements

Implement or adapt services for:

- Getting the provider's current pricing tier.
- Calculating PCS with a complete component breakdown.
- Getting available MHC packages and final EGP prices.
- Validating purchase and wallet limits.
- Creating a pending purchase.
- Confirming payment idempotently.
- Crediting MHC in one atomic transaction.
- Returning provider tier history.
- Running monthly tier recalculation.
- Supporting administrator pricing configuration.
- Supporting manual tier override.
- Reconciliation and audit reports.

A pricing quote returned by the backend should include:

```json
{
  "providerTier": "GROWTH",
  "providerCommercialScore": 47.5,
  "baseRateMinor": 200,
  "tierMultiplier": 1.0,
  "quantity": 1000,
  "packageDiscountRate": 0.05,
  "subtotalMinor": 200000,
  "discountMinor": 10000,
  "totalMinor": 190000,
  "currency": "EGP",
  "pricingVersion": "v1",
  "quoteExpiresAt": "ISO_TIMESTAMP"
}
```

Do not trust price calculations from the frontend.

The backend must recalculate or validate the quote during purchase confirmation.

---

# 12. Frontend Requirements

Show providers:

- Current tier.
- Current price per MHC.
- Available packages.
- Final EGP package price.
- MHC quantity received.
- Monthly purchase usage.
- Wallet ceiling.
- Launch allowance remaining, where applicable.
- Effective date of an upcoming tier change.
- A simple explanation of why tiers exist.

Do not show raw internal fraud signals.

Do not expose confusing formulas in the normal purchase flow.

A provider-facing explanation may state:

> MHC is a universal platform credit. Purchase pricing depends on your current provider plan and marketplace activity level. Existing MHC is never repriced when your level changes.

Avoid wording that implies:

- The provider is being punished for success.
- Wealth-based pricing.
- Secret individualized pricing.
- Different MHC coins have different spending power.

---

# 13. Anti-Abuse Requirements

Implement or prepare hooks for:

- One Launch benefit per verified identity.
- One Launch benefit per phone number.
- Duplicate business-document checks.
- Duplicate payment-instrument checks where legally and technically permitted.
- Device and risk signals.
- Linked-account review.
- No provider-to-provider MHC transfer.
- No MHC cash withdrawal.
- No wallet merging.
- Rate limits on account creation and purchase attempts.
- Manual review for suspicious linked accounts.

Do not automatically confiscate paid MHC because of a suspected linked account.

Restrict future promotional pricing while the account is under review.

---

# 14. Refund Rules

Create explicit refund behavior.

For a valid MHC purchase refund:

- Reverse only unspent refundable paid MHC where policy permits.
- Calculate the refund using the original purchase price, not the provider's current tier.
- Never use today's MHC rate for historical refunds.
- Preserve a link to the original purchase transaction.
- Perform refunds and wallet deductions atomically.
- Reject a refund when the provider no longer owns enough refundable MHC from the applicable purchase, unless partial refunds are supported.

If purchase lots are needed for refund traceability, maintain them internally without making MHC non-fungible in the normal spending experience.

---

# 15. Feature Flags and Rollout

Implement behind feature flags.

Suggested flags:

```ts
mhcTieredPricingEnabled;
mhcLaunchPricingEnabled;
mhcPackageDiscountsEnabled;
mhcMonthlyTierReviewEnabled;
mhcWalletLimitsEnabled;
mhcManualTierOverridesEnabled;
```

Recommended rollout:

## Phase 1

Use three tiers only:

| Tier         |     Price |
| ------------ | --------: |
| Launch       | 1 EGP/MHC |
| Standard     | 2 EGP/MHC |
| Professional | 3 EGP/MHC |

Phase 1 deciding factors:

- Adjusted awarded or completed value.
- Number of awards or completed jobs.
- Business verification.
- MHC consumption.

## Phase 2

Introduce:

- Starter.
- Growth.
- Professional.
- Enterprise.
- Full PCS formula.
- Category coefficients.
- Monthly downgrade hysteresis.
- Enterprise review.
- Advanced admin controls.

Do not activate Phase 2 thresholds until enough real marketplace data exists to calibrate them.

---

# 16. Required Tests

Add automated tests for at least:

## Pricing

- Correct tier multiplier.
- Correct package discount.
- Correct final EGP amount.
- Correct integer rounding.
- Maximum 10% discount.
- Historical pricing version preservation.

## Tier Calculation

- Correct PCS component normalization.
- Correct logarithmic commercial-value score.
- Correct category coefficient application.
- Correct threshold assignment.
- Correct Launch eligibility.
- Correct automatic override.
- Correct downgrade hysteresis.

## Wallet

- Atomic purchase and credit.
- No double credit after payment webhook retries.
- No negative wallet balance.
- No race-condition double spending.
- Wallet ceiling validation.
- Existing balance preservation after tier changes.

## Purchase Limits

- Monthly limit enforcement.
- Launch lifetime limit enforcement.
- Wallet ceiling enforcement.
- Existing excess balance not removed.
- New purchases blocked above ceiling.

## Refunds

- Refund uses original purchase price.
- No refund beyond refundable unspent balance.
- Idempotent refund processing.
- Correct ledger reversal.

## Security

- Frontend cannot alter final price.
- Unauthorized users cannot view or modify another provider's tier.
- Manual overrides require privileged roles.
- Audit logs are created.

---

# 17. Migration Safety

Before changing production behavior:

1. Inspect the current MHC wallet, payment, bid, advertising, and provider schemas.
2. Identify every location that reads or writes MHC balances.
3. Identify all direct balance mutations that bypass a ledger.
4. Add migrations without deleting current balances.
5. Assign all existing providers to a default tier initially.
6. Preserve all existing MHC at full usability.
7. Backfill tier state safely.
8. Introduce pricing configuration with a version.
9. Add reconciliation checks.
10. Keep the old purchasing path available behind a rollback flag until the new flow is verified.

Do not rewrite historical transactions using new prices.

Do not infer historical purchase prices unless reliable records exist.

Mark unknown historical purchase cost explicitly.

---

# 18. Required Deliverables

Before implementation, return:

1. Current-system analysis.
2. Relevant files and services.
3. Existing MHC balance and payment flow.
4. Risks and incompatibilities.
5. Proposed database migration plan.
6. Proposed service architecture.
7. Proposed API changes.
8. Proposed UI changes.
9. Feature-flag rollout plan.
10. Test plan.

Then implement in small, reviewable steps.

After implementation, return:

1. Files changed.
2. Migrations added.
3. Pricing logic summary.
4. Tier-calculation summary.
5. Security controls.
6. Tests added and their results.
7. Manual verification steps.
8. Known limitations.
9. Rollback instructions.
10. Recommended thresholds to recalibrate after real usage data is available.

---

# 19. Non-Negotiable Constraints

- MHC remains universal and fungible.
- A bid may remain fixed at 20 MHC.
- Do not price MHC according to the future action where it will be spent.
- Do not reprice existing balances.
- Do not remove existing MHC during tier changes.
- New tier prices apply to future purchases only.
- Do not trust frontend pricing.
- Do not use floating-point values for money.
- Do not allow unlimited cheap-credit stockpiling.
- Do not hard-code pricing values throughout the codebase.
- Preserve complete auditability.
- Use feature flags and migration-safe rollout.
- Do not silently modify unrelated systems.
- Follow the repository's current architecture, naming, validation, authorization, testing, and transaction conventions.

---

# 20. Initial Recommended Configuration

Use this only as a pilot configuration, not as permanently final pricing.

```json
{
  "currency": "EGP",
  "baseRateMinor": 200,
  "tiers": {
    "LAUNCH": {
      "multiplier": 0.5,
      "monthlyPurchaseLimitMhc": 200,
      "lifetimePurchaseLimitMhc": 400,
      "walletLimitMhc": 400
    },
    "STARTER": {
      "multiplier": 0.75,
      "monthlyPurchaseLimitMhc": 1000,
      "walletLimitMhc": 1500
    },
    "GROWTH": {
      "multiplier": 1.0,
      "monthlyPurchaseLimitMhc": 3000,
      "walletLimitMhc": 5000
    },
    "PROFESSIONAL": {
      "multiplier": 1.5,
      "monthlyPurchaseLimitMhc": 10000,
      "walletLimitMhc": 15000
    },
    "ENTERPRISE": {
      "multiplier": 2.0,
      "monthlyPurchaseLimitMhc": null,
      "walletLimitMhc": null
    }
  },
  "scoreThresholds": {
    "STARTER_MAX": 34,
    "GROWTH_MAX": 59,
    "PROFESSIONAL_MAX": 79
  },
  "packageDiscounts": [
    { "quantity": 100, "discountRate": 0.0 },
    { "quantity": 300, "discountRate": 0.03 },
    { "quantity": 1000, "discountRate": 0.05 },
    { "quantity": 3000, "discountRate": 0.07 },
    { "quantity": 10000, "discountRate": 0.1 }
  ],
  "categoryCoefficients": {
    "DIGITAL_CONSULTATION": 1.0,
    "ENGINEERING_DESIGN": 0.9,
    "LABOR_HEAVY_MAINTENANCE": 0.75,
    "MIXED_LABOR_MATERIALS": 0.55,
    "MATERIAL_HEAVY": 0.35
  },
  "scoring": {
    "commercialValueWeight": 50,
    "completedJobsWeight": 20,
    "mhcConsumptionWeight": 15,
    "businessScaleWeight": 10,
    "completionReliabilityWeight": 5,
    "commercialValueCapEgp": 200000,
    "completedJobsCap": 20,
    "mhcConsumptionCap": 2000,
    "windowDays": 90
  }
}
```

Treat all thresholds and prices as configurable pilot values that must later be recalibrated from:

- Provider conversion.
- MHC purchase frequency.
- Bid conversion.
- Provider retention.
- Marketplace liquidity.
- Revenue per active provider.
- Revenue by provider tier.
- Fraud and duplicate-account rates.
- Small-provider participation.
- High-volume provider churn.
