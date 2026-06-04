# MohandisHub — production QA checklist (for testers)

Copy everything below the line into email or a spreadsheet. Check each line when done.

**Tester:** __________________ **Date:** __________________ **Build / environment:** __________________

**Accounts to use:** customer · expert · business · craftsman · admin (`is_admin` flag)

---

**1. Authentication and sessions**

- [ ] Register as customer, expert, business, and craftsman (validation: weak password, duplicate email, required fields).
- [ ] Login and logout; session survives refresh and a new tab.
- [ ] Token refresh after idle time; no unexplained logout while using the app.
- [ ] Forgot password → email → reset password → login.
- [ ] Email verification (OTP or link, per environment).
- [ ] OTP send/verify if your flows use phone or email OTP (`docs/OTP_EMAIL_RUNBOOK.md`).
- [ ] Onboarding per role; blocked steps when verification is still pending.
- [ ] Non-admin cannot open admin URLs; server returns forbidden where expected.
- [ ] Actions that require verified email show a clear message until verified.
- [ ] If staging can toggle `signupsLocked` / `lockLogins`, behavior matches policy.

---

**2. Authorization and data isolation**

- [ ] Each role only sees menus and actions they are allowed (customer vs provider).
- [ ] Plan link hidden when plans feature is off (`featurePlansEnabled` / app status).
- [ ] Sidebar hides items listed in app status `sidebarHiddenHrefs` without breaking layout.
- [ ] Changing IDs in the URL or API (other user’s need, job, reservation, wallet, chat, ad, review) does not leak data.

---

**3. Admin**

- [ ] User list and search; deactivate or suspend if available.
- [ ] Verification queue for expert, business, craftsman; KYC if enabled (`docs/KYC_RUNBOOK.md`).
- [ ] `pauseVerificationSubmissions` shows a clear block when on.
- [ ] Plans: assign or change; effect visible in the app.
- [ ] Categories and services moderation if present in the panel.
- [ ] Wallet/transaction oversight; money-movement pause respected.
- [ ] Broadcast notifications if implemented.
- [ ] Support tickets: list, assign, status.
- [ ] Admin without a specific permission cannot run that action (permission matrix).
- [ ] Advertisements: list all, change status, schedule, pricing override, global ad controls (`manage_ads`, `manage_ad_scheduling`, `manage_ad_pricing`).
- [ ] Media library: create/edit/delete assets (banner, announcement, hero, general); schedule windows; public banner when flag enabled.
- [ ] Retention and moderation: dashboard, sweep dry/real if allowed, exports, clear need references, clear bid attachment, remove service image — audit trail OK.

---

**4. Customer needs (post → bid → award → complete)**

- [ ] Create a need (fields and attachments); `pauseNeeds` blocks when enabled.
- [ ] Expert/craftsman bids; `pauseBids` blocks when enabled.
- [ ] Customer awards one bid; `pauseAwardBids` blocks when enabled; losers see correct state.
- [ ] Complete, cancel, or expire paths; no double award.
- [ ] History and notifications look correct after the flow.

---

**5. Jobs (business)**

- [ ] Post job; applicants see it correctly.
- [ ] Apply; business sees applicants; reject or shortlist if available.
- [ ] Award hire; statuses update for both sides.
- [ ] Job application chat: messages, realtime, only participants can read.

---

**6. Services, browse, discovery**

- [ ] Provider creates, edits, and publishes services (category, price, area).
- [ ] **Price negotiable:** on My Services, toggle “Price is negotiable” on create and edit; list shows negotiable state; reload keeps the value.
- [ ] **Price negotiable in UI:** search/home shows negotiable services with the correct label (e.g. “(negotiable)”).
- [ ] Browse and Projects routes load for the right roles.
- [ ] Search filters (rating, price, verified, sort) behave sensibly.
- [ ] Recommendations if exposed in UI or API.
- [ ] Verified and top-rated badges where designed.
- [ ] Favorites add/remove and persist.

---

**7. Price negotiations (feature)**

- [ ] **Customer:** from service discovery/booking flow, open **negotiate price** (modal), submit offer or counter; see status updates.
- [ ] **Provider (expert/craftsman/business):** **Price negotiations** page (`/app/negotiations`) lists inbound negotiations; accept, reject, or counter; “waiting for customer” state when correct.
- [ ] **Customer:** after provider accepts, **book with agreed price** path works if implemented from the modal.
- [ ] **Non-provider** opening `/app/negotiations` is redirected away (e.g. to app home).
- [ ] **Sidebar:** “Price negotiations” link visible for providers; unread dot appears for `price_negotiation` notifications and clears after visiting the page.

---

**8. Notification center and notification links (deep links)**

- [ ] Bell / notification list opens; unread items are visually distinct; mark-as-read works.
- [ ] **Reservation notifications** (`reservation_*`): tap opens **Bookings** with `?reservation=<id>` and the matching reservation **detail opens** (same for shared link).
- [ ] **Chat** (`chat_message`): tap opens **Chat** with `?c=<conversationId>` and the correct thread selected.
- [ ] **Price negotiation** (`price_negotiation`): tap opens **`/app/negotiations`** with `?negotiation=<id>` when payload includes id; provider without mapped href still lands on negotiations page (fallback).
- [ ] **Wallet** (`wallet_*`): tap opens **Settings → wallet** path (`/app/settings/wallet`).
- [ ] **Service moderation** (`service_approved`, `service_rejected`, `service_paused_by_admin`): tap opens **My Services** with `?service=<id>` when payload has id.
- [ ] **Reviews** (`review_received`, `review_report_resolved`, `review_dispute_resolved`): tap opens **Profile** (`/app/profile`).
- [ ] **Needs/bids** (`need_bid_*`, `need_closed`): tap goes to **app home** with `?need=<id>` in the URL when payload includes need (confirm URL; deep scroll/highlight may vary).
- [ ] **Jobs** (`job_*`, `application_status`, `milestone_*`, `new_message` mapped to projects): tap goes to **`/app/projects`** with `?job=` / `?application=` when payload includes ids (if Projects is still “Coming soon”, confirm URL/query is still correct for when the page ships).
- [ ] **Admin broadcast** (`admin`, `demo`): tap goes to app home or sensible default without error.
- [ ] Realtime: new notification appears via socket without full refresh when possible.

---

**9. Reservations and bookings**

- [ ] Provider: calendar/slots; **Calendar** route for expert/craftsman/business.
- [ ] Customer books; provider calendar updates; online vs offline rules and hourly pricing flag if used.
- [ ] Reschedule and cancel; refunds or ledger as designed.
- [ ] No duplicate booking from double submit.
- [ ] Complete flow and settlement (`docs/ESCROW_AND_DISPUTES.md`); disputes via support.
- [ ] **Bookings** list/detail; **review** after eligible completion; no duplicate review where forbidden.
- [ ] **Profile:** reviews list for a provider with pagination.

---

**10. Wallet, NOWPayments, and InstaPay**

- [ ] Balance and currency display; wallet disabled flag if used.
- [ ] Deposit paused and min/max deposit enforced.
- [ ] Admin payment-method toggles work: NOWPayments crypto deposit on/off, card deposit off for launch, InstaPay deposit/withdrawal on/off.
- [ ] NOWPayments live smoke with a platform-owned account and a small amount (`docs/NOWPAYMENTS_RUNBOOK.md`): checkout opens, IPN credits once, receipt/balance match.
- [ ] InstaPay deposit info and proof submit; admin approve/reject if manual.
- [ ] Withdrawal: create, quote, cancel, verify step if any; crypto withdrawal only if NOWPayments mass payouts are enabled.
- [ ] Receipt from a transaction id.
- [ ] Insufficient balance on reservation, plan, ads, and other paid actions.
- [ ] Call billing and low balance (warning or auto-end).
- [ ] **Ads:** wallet debit when ad pricing is greater than zero; ledger text readable.

---

**11. Calls (Agora)**

- [ ] Start audio/video; permissions; join/leave; short network drop.
- [ ] End call; charges/history if billed.

---

**12. Chat**

- [ ] List threads; open; send/receive; realtime; load history.
- [ ] Reply, attachment, link message types if in UI.
- [ ] Delete for me vs everyone; closed thread cannot send.
- [ ] `pauseChat` and `pauseUploads` show clear errors.
- [ ] Unread indicator on sidebar clears when opening Chat.

---

**13. Plans**

- [ ] View plan; subscribe from wallet; failures handled.
- [ ] `pausePlanSubscriptions` and plans feature flag hide or block correctly.
- [ ] Plan limits enforced.

---

**14. Support**

- [ ] User: create ticket, reply, thread.
- [ ] Admin: list, assign, status.

---

**15. Profile and documents**

- [ ] Edit profile; avatar rules per role.
- [ ] Documents and verification status affect badges and gates (including **creating ads** for verified providers only).
- [ ] Report or dispute a review where UI exists.

---

**16. Advertisements (My Ads)**

- [ ] With `NEXT_PUBLIC_ENABLE_ADS=true`, home slideshow works; with flag off, no broken layout.
- [ ] Only providers create ads; verified required.
- [ ] Create campaign; wallet debit when priced; insufficient balance error.
- [ ] List, edit, delete; statuses match admin actions; `acceptAds` false blocks new campaigns.
- [ ] Click ad: tracking + navigation (e.g. advertiser profile).
- [ ] Admin schedule and pricing override.

---

**17. Public marketing and maintenance**

- [ ] With `NEXT_PUBLIC_ENABLE_MEDIA_LIBRARY=true`, announcement/banner from API shows; schedule respected.
- [ ] Maintenance mode message and access rules.

---

**18. Language and legal**

- [ ] English and Arabic: RTL, no clipped text on main flows (ads, bookings, negotiations, notifications).
- [ ] Terms and Privacy in both locales.

---

**19. PWA and routing**

- [ ] Manifest; install if applicable.
- [ ] Hard refresh and deep links on `/app/*` routes (bookings, chat, negotiations, wallet, ads, calendar, browse).

---

**20. Non-functional**

- [ ] Performance under realistic list sizes (admin, chat, notifications, ads).
- [ ] Normal browsing does not hit rate-limit false positives (429).
- [ ] HTTPS, cookies, CORS; no secrets in frontend bundle.
- [ ] Safe error messages for users.
- [ ] Smoke: `docs/E2E_RUNBOOK.md` five journeys; spot-check notification clicks and negotiations.
- [ ] Keyboard and focus on auth; accessible labels on notification list and ad carousel.
- [ ] Mobile: sidebar, chat, calls, notifications dropdown, negotiation forms.

---

**Reference (optional)**

- E2E: `docs/E2E_RUNBOOK.md`
- Features: `docs/FEATURE_ROADMAP_STATUS_AND_TESTING.md`
- Escrow: `docs/ESCROW_AND_DISPUTES.md`
- KYC: `docs/KYC_RUNBOOK.md`
- Agora: `docs/AGORA_RUNBOOK.md`
- OTP/email: `docs/OTP_EMAIL_RUNBOOK.md`
- Spec: `docs/LOVABLE_APP_SPEC.md`

**Spreadsheet columns (optional):** Section | Line | Pass/Fail | Notes | Bug ID
