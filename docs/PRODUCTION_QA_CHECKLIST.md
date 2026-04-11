# Production QA checklist — MohandisHub

Use this list for final sign-off before release. Execute on **staging** or the **release candidate** build. Record pass/fail, notes, and bug IDs per row.

**Roles in scope:** customer, expert, business, **craftsman** (provider role alongside expert), and **admin** (`is_admin` flag, separate from primary role).

**Recently expanded product areas (ensure coverage):**

- **Advertisements (“My Ads”)** — provider-paid campaigns, wallet debit, admin approval/scheduling/pricing, home slideshow (`NEXT_PUBLIC_ENABLE_ADS`).
- **Reviews** — post–booking (and related) review creation, profile listing, **report** and **dispute** APIs used from UI where exposed.
- **Admin media library** — banners / announcements / hero assets (`NEXT_PUBLIC_ENABLE_MEDIA_LIBRARY`, public `GET /api/media/active`).
- **Admin retention & moderation** — retention dashboard, sweeps, exports, clearing need references / bid attachments / service images.
- **App status & kill switches** — `/api/app/status`: maintenance, pauses (needs, bids, uploads, chat, plans, wallet features), signups/login locks, `sidebarHiddenHrefs`, deposit limits.
- **Wallet** — InstaPay deposit submit, deposit estimate/currencies, withdrawal **quote**, **cancel**, **verify** (where applicable).
- **OTP** — authenticated `POST /api/otp/send` and `/api/otp/verify` if the product flow uses them.
- **Price negotiable (services)** — provider toggle **“Price is negotiable”** on create/edit (`is_negotiable` / `isNegotiable`); shown on service list and in app home search result detail when applicable.

**Handoff block for testers**

> Before handoff, confirm all sections below were executed, with evidence (screenshots / ticket IDs) for any failure.

---

## 1. Authentication, sessions, and account security

- [ ] Register: customer, expert, business, craftsman — validation (weak password, duplicate email, required fields).
- [ ] Login / logout; session correct after refresh and new browser tab.
- [ ] Token refresh: long session / idle behavior; no silent “stuck logged out” on navigation.
- [ ] Forgot password → email → reset → new password → login.
- [ ] Email verification flow (OTP or link, per environment).
- [ ] **OTP (API):** if the UI uses phone/email OTP, send → verify → gated action succeeds; invalid/expired code handled (`docs/OTP_EMAIL_RUNBOOK.md`).
- [ ] Onboarding per role; blocked or gated steps when verification is pending.
- [ ] Non-admin cannot access admin routes; forbidden actions clearly denied.
- [ ] Email-verified gate: protected actions fail with clear messaging until verified.
- [ ] **Login/signup locks:** with admin `lockLogins` / `signupsLocked` (if toggled on staging), behavior matches policy.

---

## 2. Authorization and data isolation

- [ ] Each role sees only allowed menus and actions (customer vs provider matrix); **Plan** hidden when `featurePlansEnabled` is false.
- [ ] Sidebar respects `sidebarHiddenHrefs` from app status (items disappear without broken layout).
- [ ] Cross-user access: tampering IDs (URL/API) for needs, jobs, reservations, wallet, chat, **advertisements**, **reviews** — expect deny.
- [ ] Craftsman flows consistent wherever “provider” applies (services, calendar, bids, ads).

---

## 3. Admin

- [ ] User list: search, deactivate/suspend if present.
- [ ] Verification queue: expert, business, craftsman; KYC if Didit/manual is enabled (`docs/KYC_RUNBOOK.md`).
- [ ] **Verification pause:** `pauseVerificationSubmissions` blocks new submissions with a clear message.
- [ ] Plans: assign/change; effect visible in app (limits, charges).
- [ ] Categories / services moderation (if in panel).
- [ ] Transactions / wallet oversight (audit views); **money movements paused** behaves as expected (no unintended credits/debits).
- [ ] Admin notifications broadcast (if implemented).
- [ ] Support tickets: list, assign, status (`docs/FEATURE_ROADMAP_STATUS_AND_TESTING.md`).
- [ ] Admin permission matrix: admin without specific permission cannot perform restricted actions.
- [ ] **Advertisements:** list all ads; set status; schedule; pricing override; **global ad controls** (e.g. accept new campaigns, price per day). Permissions: `manage_ads`, `manage_ad_scheduling`, `manage_ad_pricing`.
- [ ] **Media library:** CRUD for usage types (banner, announcement, hero, general); schedule windows; active assets appear on site when flag enabled.
- [ ] **Retention & moderation:** dashboard readable; dry run vs real sweep (if permitted); export sweep/moderation logs; **clear need references**, **clear bid attachment**, **remove service image** — only with permission; audit trail sensible.

---

## 4. Customer needs: post → bid → award → complete

- [ ] Create need (required fields, attachments if any); **pauseNeeds** prevents posting when enabled.
- [ ] Expert/craftsman places bid; **pauseBids** blocks new bids when enabled.
- [ ] Customer compares bids, awards one; **pauseAwardBids** blocks award when enabled; other bidders see correct state.
- [ ] Complete / cancel / expire; no double-award.
- [ ] Post-completion: history and notifications correct.

---

## 5. Jobs (business): post → applicants → award → downstream

- [ ] Business creates job; correct visibility to applicants.
- [ ] Apply flow; business sees applicants; reject/shortlist if present.
- [ ] Award; status transitions for both sides.
- [ ] Job application chat: messages, real-time updates, access only for involved parties.
- [ ] Sidebar **jobs unread** indicator (if applicable) clears when visiting home.

---

## 6. Services catalog and discovery

- [ ] Expert/business/craftsman: create/edit/publish service (categories, pricing, areas).
- [ ] **Price negotiable:** on **My Services** (`/app/services`), create a service with **“Price is negotiable”** checked — save succeeds; service list shows negotiable state (not only a fixed/hourly price label). Edit existing service: toggle on/off, save, reload — value persists (`isNegotiable` / API `is_negotiable`).
- [ ] **Price negotiable (discovery):** where services appear in search/home UI, selecting a negotiable service shows the correct indicator (e.g. “(negotiable)” next to price context).
- [ ] **Browse** (`/app/browse`) and **Projects** (`/app/projects`) routes load and match role expectations.
- [ ] Browse/search: filters (rating, price, verified, sort) and sensible results.
- [ ] Recommendations (API or UI) if shipped.
- [ ] Badges: Verified, Top rated where applicable.
- [ ] Favorites: add/remove provider or service; persists after reload.

---

## 7. Reservations, bookings, settlement, and reviews

- [ ] Provider: create/edit availability; **Calendar** route (`/app/calendar`) for expert/craftsman/business.
- [ ] Customer: book slot; confirmation; provider calendar reflects booking.
- [ ] Online vs offline modes: correct rules (pricing, duration, flags); **hourly pricing** flag if `featureHourlyPricingEnabled` is relevant to your build.
- [ ] Reschedule / cancel; refunds or ledger entries if applicable.
- [ ] Double-submit / idempotency: rapid confirm does not duplicate bookings.
- [ ] Complete reservation; settlement per `docs/ESCROW_AND_DISPUTES.md`.
- [ ] Dispute path: support ticket + admin handling.
- [ ] **Bookings screen** (`/app/bookings`): list/filter states; open detail; **leave review** after eligible completion (rating, comment); cannot review twice where forbidden.
- [ ] **Reviews — profile:** list reviews for a provider (`targetUserId` / `targetType`); pagination; empty state.

---

## 8. Wallet, InstaPay, non-crypto (crypto optional this pass)

- [ ] Balance display; currency formatting (e.g. EGP); **wallet disabled** via app status if configured.
- [ ] **Deposits paused** / **min–max deposit** amounts enforced in UI and API.
- [ ] Deposit: currencies list and **estimate** (if exposed); checkout path for enabled methods.
- [ ] **InstaPay:** deposit info, submit proof flow; admin acceptance path (if manual).
- [ ] Withdrawal: create request; **quote**; **cancel** (if allowed); **verify** step (e.g. OTP) if implemented.
- [ ] Receipt: transaction list → receipt API or UI (`GET /api/wallet/me/transactions/:id/receipt`).
- [ ] Insufficient balance: reservations, plans, **advertisement purchase**, paid actions fail cleanly.
- [ ] Call billing: low-balance behavior during audio/video (warning / auto-end per implementation).
- [ ] **Advertisement creation** debits wallet when `pricePerDay × durationDays > 0`; ledger reason readable.

---

## 9. Calls (audio / video / Agora)

- [ ] Start call from intended entry points; browser mic/camera permissions.
- [ ] Remote join/leave; brief network drop recovery.
- [ ] End call; duration/charges reflected in wallet/history if billed; rates align with app status (`reservationVoiceMinuteRate` / `reservationVideoMinuteRate` if tester can view config).

---

## 10. Chat (main app)

- [ ] Open/start conversation from profile, need, or job context as designed.
- [ ] Send/receive text; real-time delivery; load older messages; **unread** indicator clears on visiting chat.
- [ ] Reply, attachments, link/location types if exposed in UI.
- [ ] Delete for me vs for everyone; closed conversation cannot send.
- [ ] **pauseChat:** sending fails with clear server/UI messaging.
- [ ] **pauseUploads:** chat or other uploads fail gracefully where applicable.

---

## 11. Plans and monetization

- [ ] View current plan; upgrade/downgrade if applicable.
- [ ] Wallet payment for plan; failure paths.
- [ ] **pausePlanSubscriptions** and **featurePlansEnabled** hide or block subscription flows correctly.
- [ ] Plan limits enforced (posting, features, allowed roles).

---

## 12. Notifications and email

- [ ] In-app notifications for key events (bid, award, booking, message, verification, **ad status**, jobs).
- [ ] Transactional email when applicable; **pauseOtpEmails** does not break critical flows unexpectedly.
- [ ] No duplicate storms on retries.

---

## 13. Support

- [ ] User: create ticket, reply, view thread.
- [ ] Admin: list, assign, change status.

---

## 14. Profile, documents, verification

- [ ] Profile edit; avatar rules per role (e.g. expert/craftsman).
- [ ] Document upload; pending → approved/rejected; effect on verified badge and gated actions (including **creating ads** — requires verified provider).
- [ ] **Reviews:** report abusive review; dispute (reviewee flow); admin visibility if any.

---

## 15. Advertisements (“My Ads” and sponsored surfaces)

- [ ] **Env:** with `NEXT_PUBLIC_ENABLE_ADS=true`, home **Ad slideshow** loads active ads; without flag, no errors and no empty broken UI.
- [ ] Customer: cannot create ads; no server acceptance if role is wrong.
- [ ] Verified expert/business/craftsman: **My Ads** (`/app/advertisements`) — create campaign (copy, images, duration, optional start); preview; **wallet debit** on submit when pricing is greater than zero; insufficient balance error.
- [ ] List “my” ads; edit; delete where allowed; statuses (pending/approved/rejected/expired) match admin actions.
- [ ] **Admin disabled ads** (`acceptAds` false): creation returns clear “not accepting campaigns” behavior.
- [ ] Click ad: **click tracked**, navigation (e.g. advertiser profile) correct.
- [ ] **Admin-only** scheduling and pricing override change visibility and billing expectations as designed.

---

## 16. Marketing site & media (public)

- [ ] With `NEXT_PUBLIC_ENABLE_MEDIA_LIBRARY=true`, **announcement** (and other configured) assets from `GET /api/media/active` show on landing/global banner; schedule `startsAt`/`endsAt` respected.
- [ ] **Maintenance mode:** public and app behavior per `docs` / banner message (`maintenanceMode`, `maintenanceMessage`).

---

## 17. Internationalization and legal

- [ ] English and Arabic: RTL layout, no clipped text on critical flows (including **My Ads**, bookings, reviews).
- [ ] Terms and Privacy pages in both locales.

---

## 18. PWA / web routing

- [ ] Manifest present (`/manifest.json`); optional install behavior.
- [ ] Refresh and deep links on nested `app` routes work in production build (`/app/advertisements`, `/app/calendar`, `/app/browse`, etc.).

---

## 19. Non-functional / production readiness

- [ ] Performance: search, chat, admin lists, **admin ads list**, **media list**, with realistic data.
- [ ] **Rate limiting:** normal browsing (wallet poll, reservations poll, multiple tabs) does not produce false **429** lockouts.
- [ ] Security: HTTPS, cookies, CORS; no secrets in client bundle; env flags only for non-sensitive toggles.
- [ ] Errors: user-safe messages; consistent API error shape; critical failures observable server-side.
- [ ] Post-deploy smoke: `docs/E2E_RUNBOOK.md` (five must-pass journeys minimum); add a pass over **My Ads** route and **bookings** if not already automated.
- [ ] Accessibility: keyboard on auth forms, focus, contrast on primary flows; slideshow/ads have sensible `aria-label`.
- [ ] Mobile: sidebar, chat input, call UI, **ad carousel**, booking review form on narrow viewports.

---

## Reference docs

| Topic | Doc |
|--------|-----|
| E2E / Playwright | `docs/E2E_RUNBOOK.md` |
| Feature testing notes | `docs/FEATURE_ROADMAP_STATUS_AND_TESTING.md` |
| Launch vs placeholder | `docs/LAUNCH_SCOPE.md` |
| Escrow / disputes | `docs/ESCROW_AND_DISPUTES.md` |
| KYC | `docs/KYC_RUNBOOK.md` |
| Agora | `docs/AGORA_RUNBOOK.md` |
| OTP / email | `docs/OTP_EMAIL_RUNBOOK.md` |
| App spec (routes, roles) | `docs/LOVABLE_APP_SPEC.md` |

---

## Spreadsheet column suggestion

| Section | Item | Build | Tester | Date | Pass/Fail | Notes | Bug ID |

Copy checklist rows into your tracker and fill the metadata columns per run.
