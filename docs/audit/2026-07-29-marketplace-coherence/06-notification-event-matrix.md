# 06 — Notification Event Matrix

---

## 1. Infrastructure assessment

The notification **plumbing** is class 1 and better than expected:

| Capability                   | Class | Evidence                                                                                        |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| Persistence                  | 1     | `notifications` table, migration `20260313000001`                                               |
| Category mapping             | 1     | `CATEGORY_BY_TYPE`, 11 categories                                                               |
| Per-type/channel preferences | 1     | `REQUIRED_IN_APP` floor prevents opting out of money events                                     |
| Socket delivery              | 1     | `getSocketServer()`, `join_user` room                                                           |
| Toast on receipt             | 1     | `app-shell.tsx:107`                                                                             |
| Email fallback               | 1     | `sendTransactionalEmail`, opt-in per type                                                       |
| Web push                     | 1     | `web-push`, subscription table                                                                  |
| Missing-table dev fallback   | 1     | Guarded to non-production                                                                       |
| Mark read / mark all read    | 1     | `notifications.routes.ts`                                                                       |
| Bilingual rendering          | 2     | `notification-display.ts` + dictionary; **many messages are hardcoded English at the producer** |
| Deep links                   | 2     | Map exists; several targets are wrong                                                           |
| Unread counts                | 2     | Five booleans, prefix-matched (`app-sidebar.tsx:44-88`)                                         |
| Deduplication                | 6     | None                                                                                            |
| Failure handling             | 2     | Every producer is `void … .catch(() => {})` — silent                                            |

**The gap is not the delivery system. It is that the newest workflow does not emit events.**

---

## 2. Event → notification matrix

Legend — **Class**: 1 working · 4 partial · 5 broken · 6 missing.

### 2.1 Needs and bids

| Event                                    | Type                | Recipient    | Class | Notes                                                           |
| ---------------------------------------- | ------------------- | ------------ | ----- | --------------------------------------------------------------- |
| Bid received on a need                   | `need_bid_received` | customer     | 1     | `needs.service.ts:234`                                          |
| Bid edited                               | —                   | customer     | 6     | Customer never learns a proposal changed                        |
| Bid withdrawn                            | —                   | customer     | 6     | Customer may award a withdrawn bid                              |
| Award offered                            | `need_bid_awarded`  | provider     | 1     | `needs.service.ts:551`. Message names the deadline — good       |
| **Activation required reminder**         | —                   | provider     | 6     | **Highest-value missing notification.** Offer expires silently  |
| Award accepted + activated               | —                   | **customer** | 6     | **The customer is never told their provider paid and is ready** |
| Contact unlocked                         | —                   | both         | 6     | The moment the fee buys something is unannounced                |
| Award declined                           | `need_bid_rejected` | customer     | 4     | `mhc.service.ts:808`                                            |
| Award expired                            | `need_bid_rejected` | both         | 4     | Reuses the reject type; message does not distinguish            |
| Losing bids rejected                     | `need_bid_rejected` | providers    | 1     | Correctly deferred until the winner pays                        |
| Need closed                              | `need_closed`       | bidders      | 1     | `needs.service.ts:336`                                          |
| Bid paid (legacy escrow)                 | `need_bid_paid`     | provider     | 5     | Escrow retired; type is dead                                    |
| Milestone created / submitted / approved | —                   | —            | 6     | Feature does not exist                                          |
| Project completed                        | —                   | both         | 6     | Feature does not exist                                          |
| Review requested                         | —                   | both         | 6     | Feature does not exist                                          |

### 2.2 Reservations — the reference implementation

| Event                                     | Type                                         | Class |
| ----------------------------------------- | -------------------------------------------- | ----- |
| Created                                   | `reservation_created`                        | 1     |
| Accepted / Rejected                       | `reservation_accepted` / `_rejected`         | 1     |
| Started / Completed / Cancelled / Expired | four types                                   | 1     |
| Location proposed                         | `reservation_location_proposed`              | 1     |
| Disputed / resolved                       | `reservation_disputed` / `_dispute_resolved` | 1     |

Ten types, all with producers, all in `REQUIRED_IN_APP`. **This is what the needs path should look like.**

### 2.3 MHC and money

| Event                                      | Type                  | Class | Notes                                                  |
| ------------------------------------------ | --------------------- | ----- | ------------------------------------------------------ |
| Deposit approved / rejected / confirmed    | `wallet_deposit_*`    | 5     | Deep-link to a retired screen                          |
| Withdrawal completed / rejected            | `wallet_withdrawal_*` | 5     | Feature retired                                        |
| **MHC purchase approved**                  | —                     | 6     | Provider pays by InstaPay and gets **no confirmation** |
| **MHC purchase rejected**                  | —                     | 6     | Silent failure after a real-money transfer             |
| **MHC purchase under review**              | —                     | 6     | —                                                      |
| **MHC charged for activation**             | —                     | 6     | Money leaves the balance silently                      |
| **Low MHC balance**                        | —                     | 6     | Provider discovers it at the worst moment — mid-award  |
| Ad campaign approved / rejected / expiring | —                     | 6     | —                                                      |

**The MHC purchase gap is the most commercially damaging item in this matrix.** A provider transfers real money via InstaPay, waits for a manual review, and the system tells them nothing at any stage. The purchase-state vocabulary already exists — `describePurchaseState()` in `lib/mhc/presentation.ts` produces exactly the right bilingual copy for every state, and it is tested. It is simply never used to send a notification.

### 2.4 Support, disputes, verification

| Event                            | Type              | Class |
| -------------------------------- | ----------------- | ----- |
| Support ticket reply from staff  | —                 | 6     |
| Ticket status changed            | —                 | 6     |
| Ticket escalated to dispute      | —                 | 6     |
| Verification approved / rejected | —                 | 6     |
| Verification info requested      | —                 | 6     |
| Review received                  | `review_received` | 1     |
| Review report / dispute resolved | two types         | 1     |

Verification is a multi-day manual process with **no notification at any point**. Users must poll their own profile.

### 2.5 Plans, teams, services

| Event                                                 | Class                                         |
| ----------------------------------------------------- | --------------------------------------------- |
| Subscription activated / renewed / expiring / expired | 6                                             |
| Quota nearly exhausted                                | 6                                             |
| Team invitation                                       | 4 — email only, no in-app; raw token, no link |
| Invitation accepted / member removed / role changed   | 6                                             |
| Service approved / rejected / paused by admin         | 1                                             |
| Chat message                                          | 1                                             |
| Job application / interview / milestone (employment)  | 1                                             |

---

## 3. Summary

| Domain                     | Working | Missing/broken |
| -------------------------- | ------- | -------------- |
| Reservations               | 10      | 0              |
| Employment jobs            | 6       | 0              |
| Services                   | 3       | 0              |
| Reviews                    | 3       | 0              |
| **Needs / bids**           | **4**   | **9**          |
| **MHC**                    | **0**   | **7**          |
| **Support / verification** | **0**   | **5**          |
| **Plans / teams**          | **0**   | **6**          |
| Wallet (retired)           | 5 dead  | —              |

**The two subsystems the launch model depends on — needs/bids and MHC — have the worst notification coverage in the product.** The old subsystems are well covered; the new ones were built without notification wiring.

---

## 4. Priority additions

### P0 — silent money and silent state

1. `mhc_purchase_approved` → provider. Credits added. Deep-link to credits.
2. `mhc_purchase_rejected` → provider, with reason.
3. `award_activated` → **customer**. "Your provider activated the project. Contact details are now available."
4. `activation_reminder` → provider, at 50% and 90% of the acceptance window.
5. `mhc_low_balance` → provider, at an admin-configurable threshold.

### P1 — closing the loop

6. `support_reply`, `support_status_changed`, `case_escalated`
7. `verification_approved`, `verification_rejected`, `verification_info_requested`
8. `team_invitation` (in-app, with a working accept link)
9. `bid_updated`, `bid_withdrawn` → customer
10. `subscription_expiring`, `subscription_expired`

### P2 — with the completion workflow

11. `milestone_created`, `milestone_submitted`, `deliverable_approved`, `deliverable_rejected`, `project_completed`, `review_requested`

---

## 5. Required fixes to existing behaviour

### 5.1 Deep links point at the wrong place

```ts
need_bid_received: '/app',
need_bid_awarded:  '/app',
need_bid_rejected: '/app',
need_bid_paid:     '/app',
need_closed:       '/app',
```

All five land on the 2,430-line home screen with no context. A provider tapping "You were selected" must then find the award themselves.

Targets should be entity-specific: `/app/needs/:needId/bids/:bidId`. Since those routes do not exist yet, the interim fix is query parameters the home screen already understands (`?needId=…&bidId=…`), matching the existing `?post=1` pattern at `app-home-screen.tsx:327`.

The five `wallet_*` types point at `/app/settings/wallet`, a screen slated for retirement — retarget to the credits screen.

### 5.2 Producers hardcode English

```ts
('You were selected — activate to start',
  `A customer selected your bid. Accept and activate it within ${expiryHours} hours…`);
```

Written at the producer, stored in the DB, served to Arabic users in English. `notification-display.ts` exists to translate by type + payload, but only works when the producer supplies template params instead of a rendered string.

**Fix:** producers store `type` + `payload`; the client renders from the dictionary. This is also required for the deduplication work below.

### 5.3 Failures are silent

Every producer is `void this.notify…().catch(() => {})`. A notification outage is invisible — no log, no metric, no retry. At minimum, log at `warn` with type and recipient. For the P0 money notifications, consider an outbox row so a failed send is retryable.

### 5.4 Unread counts are fragile

`app-sidebar.tsx:44-88` maintains five booleans by prefix-matching type strings (`type.startsWith('wallet_')`, `type.startsWith('need_bid_')`). Every new type must be added by hand, and the final `else` marks everything unmatched as a "jobs" unread — so an MHC notification would light up the wrong badge.

**Fix:** derive badges from `getNotificationCategory()`, which already exists server-side and is the single source of truth.

### 5.5 No deduplication

Five rapid chat messages produce five notifications. Add a collapse key (`type + reference_id`) and suppress duplicates inside a short window, or increment a count on the existing unread row.

---

## 6. Message quality standard

Current messages are mostly good — `need_bid_awarded` names the deadline and the required action, which is exactly right. The standard to hold new ones to:

> **Name the entity. Name the action. Link to it.**

| Weak                          | Strong                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| "You have a new notification" | "Ahmed sent a proposal for _Villa structural review_ — 3 proposals to compare"          |
| "Payment received"            | "180 MHC added. Balance: 420 MHC"                                                       |
| "Status updated"              | "Your provider activated _Villa structural review_. Contact details are now available." |

Every notification should answer: _what happened, to which thing, and what should I do now?_
