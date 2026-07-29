# 12 — Capability Classification

Every capability is classified as one of:

| # | Class | Meaning |
|---|---|---|
| 1 | **Implemented and working** | End-to-end path verified: UI → API → DB. Preserve as-is. |
| 2 | **Implemented but inconsistent / poorly integrated** | Works, but conflicts with another part of the product or is hard to reach. Integrate, do not rebuild. |
| 3 | **Frontend-only or cosmetic** | UI exists; no backend effect. |
| 4 | **Partially implemented** | Some paths work, others are absent. |
| 5 | **Broken** | Code path exists but cannot succeed at runtime. |
| 6 | **Missing** | No implementation. |

**Rule applied throughout:** class 1 and 2 capabilities are *never* recommended for removal. Class 2 gets integration work. Only class 5 gets repair, and only class 6 gets new build.

---

## A. Identity, roles, access

| Capability | Class | Evidence |
|---|---|---|
| Email/password auth, refresh rotation | 1 | `auth.service.ts`, 3 test files |
| OTP (email + WhatsApp) | 1 | `otp.provider.ts`, `otp.provider.test.ts` |
| Email verification gate | 1 | `require-email-verified.ts` on most routers |
| KYC verification gate | 1 | `require-verified.ts` on bid/service creation |
| Admin as flag + permission array | 1 | `users.is_admin` + `admin_permissions[]`, `loadAdminFromDb` re-reads per request |
| `super_admin` implies all permissions | 1 | `hasAdminPermission`, `require-role.ts:16` |
| **One role per identity** | 2 | Works correctly; blocks business procurement. Architectural, not a defect |
| `'admin'` in the `UserRole` union | 2 | No row ever has it; runtime special-cases it correctly. Type-level landmine only |
| Multi-workspace per identity | 6 | No `workspaces` table, no switcher |
| Business posts a need | 6 | `requireRole('customer')` on `POST /api/needs` |

---

## B. My Services (provider catalogue)

Audited end-to-end at your request.

| Capability | Class | Evidence |
|---|---|---|
| Service CRUD | 1 | `services.routes.ts`, full controller/service/repo chain |
| Lifecycle: draft → pending_review → active → paused → rejected → archived | 1 | `services.status` CHECK; `/submit`, `/pause`, `/activate` endpoints all exist |
| Admin moderation (approve/reject/pause) with notifications | 1 | `admin.service.ts:865-919`, three notification types |
| Pricing: fixed / hourly | 1 | `price_type` CHECK, form select, `featureHourlyPricingEnabled` flag |
| Negotiable flag + negotiation flow | 1 | `is_negotiable` → `NegotiationModal` → `price_negotiations` |
| Media gallery | 1 | `images TEXT[]`, max 10, URL-validated |
| Tags | 1 | `tags TEXT[]` with GIN index, max 20 |
| Categories | 1 | `service_categories`, bilingual, hierarchical (`parent_id`), admin-managed |
| Location (city / area / country) | 1 | Columns + indexed `city` |
| Delivery time | 1 | `delivery_time_days` |
| View/order counts, avg rating | 1 | Aggregate triggers (`20260727093000`), `service_view_events` |
| Provider-type permission | 1 | `requireRole('expert','business','craftsman')` + `requireVerified` |
| Service analytics | 2 | `GET /api/analytics/me` exists and works; surfaced as a **tab inside the business dashboard**, no dedicated route |
| Plan limits on service count | 4 | `maxServices` / `maxBusinessServices` enforced in `needs`/`jobs` paths; **not verified as enforced on service creation** |
| **Packages / tiers** (basic/standard/premium) | 6 | One price per service. No package table |
| **Goods / products** | **6 — not found** | See §B.1 |
| Coupon campaigns on services | 1 | `coupons` module, wired in `services-screen.tsx:285-320` |
| Unrelated purchasing features inside My Services | — | **Not present.** The screen is catalogue + coupons only. The original brief's concern does not apply |

### B.1 Goods / products — search record

No goods or product capability was located. Searched:

- `services` schema and every `ALTER TABLE services` migration — no discriminator column
- `packages/shared/src/services.ts` — no `kind` on `Service`, `CreateServiceBody`, or `ServiceSearchResult`
- `services.validation.ts` — `priceType` is `z.enum(['fixed','hourly'])`
- `services-screen.tsx` creation form — no goods/service selector
- All 12 seeded categories — all engineering disciplines
- Repo-wide: `product`, `goods`, `listing_type`, `item_type`, `stock`, `inventory`, `shipping`, `منتج`
- All local and remote branches, both stashes, full commit log

Only `product`-named files are `product-growth.ts` (notification preferences) and `phase2_5-product-value` (saved searches, favorites) — "product" in the software sense.

**This classification is provisional.** If the capability exists under a name not covered above, it should be re-audited before any taxonomy decision is made.

---

## C. Needs / bids (RFP path)

| Capability | Class | Evidence |
|---|---|---|
| Customer posts a need | 1 | `POST /api/needs`, quota-locked |
| Provider lists open needs | 1 | `GET /api/needs` |
| Provider submits a bid | 1 | `POST /api/needs/:needId/bids`, KYC-gated |
| Bid edit / withdraw | 1 | `PATCH` / `DELETE` |
| Pre-activation bid chat | 1 | `bid_messages` + `needs.bid-chat-gate.test.ts` |
| Contact redaction in bid chat | 1 | `contact-redaction.ts` — handles Arabic-Indic digits, separator obfuscation, Arabic app names; `contact-redaction.test.ts` |
| Customer awards a bid | 1 | → `awarded_pending_provider_acceptance` |
| Award expiry worker | 1 | `award-expiry.worker.ts`, admin-configurable window |
| Provider accepts + pays MHC | 1 | `mhc.service.ts:636`, race-safe, idempotent |
| Provider declines award (free) | 1 | `POST /activations/award/:bidId/decline` |
| Customer withdraws an award | 1 | `POST /activations/award/need/:needId/withdraw` |
| Contact/attachment unlock on activation | 1 | `ActivationGateService`, fail-closed |
| Provider payment-detail disclosure + audit | 1 | `provider_payment_disclosures` |
| **MHC fee on bid submission** | 6 | No `bid_submission` action key; no charge in the bid path |
| **Proposal comparison surface** | 6 | No side-by-side view |
| **Milestones on a need-job** | 6 | `job_milestones` belongs to employment jobs |
| **Deliverables / approvals on a need-job** | 6 | — |
| **Mutual completion** | 4 | `status='completed'` is a valid value; no two-sided flow writes it |
| **Reviews after a need-job** | 5 | `ReviewsService.create` requires a completed **reservation**; a need-job satisfies no branch |
| Legacy escrow bid payment | 1 | Correctly retired: fail-closed `410 ESCROW_PAYMENTS_RETIRED`. **Model deprecation on this** |

---

## D. Services / reservations (booking path)

The most mature subsystem in the repository.

| Capability | Class |
|---|---|
| Availability slots + provider profile | 1 |
| Booking creation, accept/reject, cancel | 1 |
| Lifecycle worker (expiry, auto-transitions) | 1 |
| Check-in codes | 1 |
| Location proposals | 1 |
| Agora voice/video call sessions + participants | 1 |
| Booking activation via MHC | 1 |
| Reservation disputes with notes + evidence | 1 |
| Reviews after a completed reservation (bidirectional) | 1 |
| Reservation notifications (10 types) | 1 |

---

## E. Employment jobs

Fully built, and a **different product** from project delivery.

| Capability | Class |
|---|---|
| Business posts a hiring job (`salary_range`, `application_fee_amount`) | 1 |
| Expert applies (CV upload or profile snapshot) | 1 |
| Interview invitation → booked via reservation | 1 |
| Application status lifecycle (7 states) | 1 |
| Application messaging | 1 |
| Job milestones + submissions | 1 |
| **Milestone escrow settlement** | 5 | `wallet_hold_id` on the frozen EGP wallet |
| Reachable from navigation | 3 | `/app/projects` not in sidebar |

**Not a candidate for deletion.** It is coherent and complete; the question is whether it is *in* the launch surface, and whether "Projects" is the right name for it.

---

## F. Money

| Capability | Class |
|---|---|
| MHC ledger (`account_type`/`asset_code` on `wallets`) | 1 |
| MHC packages, admin-configurable | 1 |
| MHC purchase via manual InstaPay | 1 |
| MHC purchase via NOWPayments (own IPN) | 1 |
| Activation charge — idempotent, race-safe, transactional | 1 |
| MHC never formatted as currency | 1 |
| Provider payment methods (bank/InstaPay/mobile wallet) | 1 |
| EGP wallet ledger + history | 1 (frozen by design) |
| Deposits | 5 — all rails false; modal reachable from header |
| Withdrawals | 5 — all rails false; `canRequestWithdrawal` true for every role |
| **Ad campaign payment** | 5 — debits frozen EGP wallet (`advertisements.service.ts:63`) |
| **Plan subscription payment** | 5 — same |
| Header balance pill | 2 — works, shows the wrong asset to the wrong roles |
| Customer wallet section in profile | 2 — renders for a role with no wallet function |
| MHC screen navigation | 2 — exists and works; buried in `/app/profile`, absent from sidebar |
| MHC on ads / spotlight / promotion / subscription | 6 — action keys seeded, never charged |
| Commission split maths | 2 — `computeCommissionSplit` still exported; model abandoned |

---

## G. Plans and entitlements

| Capability | Class |
|---|---|
| Plan CRUD (admin) | 1 |
| `allowed_roles` filtering | 1 |
| Subscription periods (`plan_subscriptions`) | 1 |
| Usage quotas with action lock | 1 — `usage-quota.service.ts`, genuinely race-safe |
| `maxNeeds` enforcement | 1 |
| `maxJobs` enforcement | 1 |
| `maxActiveBids`, `maxBidsPerNeed` | 4 |
| `canPriorityBid` | 4 — read in SQL (`needs.repository.ts:265`); ordering effect unverified |
| `canProBadge`, `canTrustedBusinessBadge` | 4 — computed in `auth.service.ts:514`, surfaced as a badge. **Backed by a plan purchase, not by verification** |
| `maxTeamSlots` | 3 — defined, zod-validated, never read |
| `canBusinessFeatured`, `canPriorityListing` | 3 — same |
| Central entitlement service | 6 — checks are scattered across `needs`, `jobs`, `auth` |
| Plans hardcoded | 6 — DB-driven with admin CRUD |
| Customer plans hidden when none exist | 4 — `featurePlansEnabled` hides the whole page for everyone, not per-role |

---

## H. Support, disputes, reviews

| Capability | Class |
|---|---|
| Support tickets + threaded messages + attachments | 1 |
| Admin support queue | 1 |
| Reservation dispute case file (notes, evidence, resolution) | 1 |
| Review reports and review disputes | 1 |
| Reviews on completed reservations, bidirectional | 1 |
| **Support ticket linked to an entity** | 6 |
| **Dispute on a need-job** | 6 |
| **Escalation ticket → dispute** | 6 |
| **Single entry point** | 6 — three systems, user must self-classify |
| Support categories match user problems | 5 — `bug \| suggestion \| error \| other` is engineering taxonomy |

---

## I. Business teams

| Capability | Class |
|---|---|
| Team + member + role + invite schema | 1 |
| Built-in roles (owner/manager/member/viewer) | 1 |
| Custom roles with permission arrays | 1 |
| Team audit log | 1 |
| Invite creation + revoke | 1 |
| Invite accept endpoint | 4 — endpoint works; **no accept UI, token emailed as raw text** |
| Member views their own team | 5 — `GET /me` calls `ensureOwnerTeam`, throws 403 unless `role==='business'` |
| **Permission enforcement outside the module** | 3 — seven permissions, zero enforcement. `grep business_members` → 5 hits, all in one file |
| Member removal | 6 |
| Ownership transfer | 6 |
| Seat limits | 3 |
| Team-visible projects / assignments | 6 |

---

## J. Notifications

| Capability | Class |
|---|---|
| Persistence, list, mark-read, mark-all-read | 1 |
| Per-type/channel preferences with required-channel floor | 1 |
| Socket delivery + toast | 1 |
| Email fallback | 1 |
| Web push | 1 |
| Reservation notifications (10 types) | 1 |
| Deep links | 2 — map exists; `need_bid_*` all point at `/app` |
| Unread counts | 2 — sidebar prefix-matches type strings in five booleans |
| Activation / unlock / MHC / team / verification events | 6 — see `06` |
| Deduplication | 6 |

---

## K. Search and discovery

| Capability | Class |
|---|---|
| Service search (query, category, city, price, rating, provider type, verified, 5 sorts, pagination) | 1 |
| Saved searches | 1 — table, routes, and UI all wired (`app-home-screen.tsx:431`) |
| Recommendations with consent + event recording | 1 |
| Favorites | 1 |
| Needs search for providers | 4 — `GET /api/needs` has no comparable filter set |
| Provider/people search | 4 |
| Shared result-card component | 6 — search UI is inline in a 2,430-line file |
| Role-aware search actions | 2 — implemented via `role ===` branching inside one component |

---

## L. Navigation and dashboards

| Capability | Class |
|---|---|
| Role-filtered sidebar | 1 |
| Admin-hidden sidebar hrefs | 1 |
| Customer / expert / business dashboards | 1 |
| Business team panel in dashboard | 1 |
| Admin panel with permission-gated tabs | 1 |
| Business analytics dedicated route | 6 — tab only |
| Workspace-aware navigation | 6 |
| Route guards matching sidebar visibility | 4 — API enforces; routes render for any role |
| Calendar | 2 — **real data** (reservations, slots, profile), not a placeholder |

---

## Summary counts

| Class | Count | Disposition |
|---|---|---|
| 1 — Working | ~75 | **Preserve** |
| 2 — Inconsistent | 12 | Integrate |
| 3 — Cosmetic | 5 | Enforce or hide |
| 4 — Partial | 12 | Complete |
| 5 — Broken | 8 | **Repair** |
| 6 — Missing | 26 | Build or defer |

The repository is substantially built. The defect concentration is in **class 5 (money paths orphaned by the wallet freeze)** and **class 6 (the second half of the delivery workflow)** — not in the breadth of features.
