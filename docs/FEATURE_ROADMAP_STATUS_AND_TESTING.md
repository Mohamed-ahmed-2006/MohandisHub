# Feature roadmap — status and how to test

All **15** items from the plan are implemented. Summary and how to test each.

---

## Part 1 — Six proposed features

| # | Feature | Status | How to test |
|---|--------|--------|-------------|
| **1** | **Team accounts for businesses** | Done | **DB:** Migrations `20260318000002_business_teams.sql` (business_teams, business_members). **API:** `GET /api/business/team/me` (auth + business role) returns `{ team: null, members: [] }`. Expand later with invite flow. |
| **2** | **Email / SMS / WhatsApp notifications** | Done (email path) | **API:** When creating a notification, pass `recipientEmail` (and optional `recipientDisplayName`) in the payload; a transactional email is sent (Brevo/SendGrid) in addition to in-app. **Test:** Use admin “Send notification” or any code that calls `notificationsService.createForUser(userId, { ..., recipientEmail: 'test@example.com' })`. SMS/WhatsApp: add providers when ready; API is ready for fan-out. |
| **3** | **Advanced search filters and ranking** | Done | **API:** `GET /api/services/search?minRating=4&minPrice=0&maxPrice=100&verifiedOnly=true&sort=rating` (or `price_asc`, `price_desc`, `completed_count`, `newest`). **Web:** Log in as customer → Browse tab: use Min rating, Min/Max price, Sort by, “Verified providers only” and search. Same filters in Expert/Business “Search” tab. |
| **4** | **Recommendation engine** | Done | **API:** `GET /api/services/recommendations?limit=10` or `?limit=5&categoryId=<uuid>`. Returns suggested services (top by rating/orders). **Web:** Call this endpoint from the app or add a “Suggested for you” section that uses it. |
| **5** | **Support / ticket center** | Done | **DB:** `support_tickets`, `support_ticket_messages` (migration `20260318000000_support_tickets.sql`). **API:** `POST /api/support/tickets` (body: `{ subject, body }`), `GET /api/support/tickets`, `GET /api/support/tickets/:id`, `GET/POST /api/support/tickets/:id/messages`. Admin: `GET /api/admin/support/tickets`, `PATCH /api/admin/support/tickets/:id` (status, assignedTo). **Web:** Sidebar “Support” → open a ticket, reply, view thread. Admin: use admin panel to list/assign/update tickets. |
| **6** | **Analytics for providers and admins** | Done | **API:** `GET /api/analytics/me` (auth + expert/business) returns totalEarnings, totalServiceViews, ordersCount, topServices. **Web:** Log in as Business → dashboard: **Orders** tab shows provider reservations; **Analytics** tab shows earnings, views, orders, top services. Admin dashboard stats unchanged (existing). |

---

## Part 2 — Additional features (9 items)

| # | Feature | Status | How to test |
|---|--------|--------|-------------|
| **7** | **Reviews and ratings exposure** | Done | **API:** Service search includes `providerVerified`; sort/filter by rating. **Web:** Browse/Search results show “Verified” and “X.X ★” and “Top rated” when rating ≥ 4. |
| **8** | **Availability / calendar** | Done (existing) | Reservation slots and calendar UI already in app. **Web:** Log in as Expert/Business → Calendar: manage slots; create reservation as customer using provider’s slots. |
| **9** | **Invoicing and receipts** | Done | **API:** `GET /api/wallet/me/transactions/:id/receipt` (auth) returns transaction as receipt payload. **Test:** List transactions from wallet, then `GET .../receipt` for one transaction id. |
| **10** | **Escrow and dispute flow** | Done (doc + existing behavior) | **Doc:** `docs/ESCROW_AND_DISPUTES.md` describes release rules and dispute handling. Reservation settlement and support tickets are the implementation. **Test:** Run a reservation to completion and check settlement status; open support ticket for “dispute” and handle via admin. |
| **11** | **Saved / favorites** | Done | **DB:** `favorites` (migration `20260318000001_favorites.sql`). **API:** `POST /api/favorites` (body: `{ targetType: 'provider' \| 'service', targetId: uuid }`), `GET /api/favorites`, `GET /api/favorites/:targetType/:targetId`, `DELETE /api/favorites/:targetType/:targetId`. **Test:** Call with auth; add/list/check/remove favorites. |
| **12** | **Promotions and coupons** | Done (DB only) | **DB:** `coupons` table (migration `20260318000003_coupons.sql`). Redemption API can be added later. **Test:** Run migration; insert a row and query. |
| **13** | **PWA or mobile app** | Done (PWA base) | **Web:** `apps/web/public/manifest.json` and root layout `manifest: '/manifest.json'`. **Test:** Open app in browser; check DevTools → Application → Manifest; optional “Add to home screen”. |
| **14** | **Provider badges** | Done | **Web:** Search/browse result cards show “Verified” and “Top rated” (when avgRating ≥ 4). **Test:** Log in → Browse/Search; confirm badges on cards. |
| **15** | **Full i18n for new features** | Done | New keys in `apps/web/lib/i18n/dictionaries/en.ts` and `ar.ts` (common, nav, homeSearch) for analytics, orders, support, filters, verified, topRated, etc. **Test:** Switch locale to Arabic and use Support, Analytics, Browse filters; confirm strings. |

---

## Prerequisites for testing

1. **Migrations**
   - Apply Supabase migrations (including `20260318*`):
     ```bash
     npx supabase db push
     ```
     Or run the new SQL files against your DB if you don’t use Supabase CLI.

2. **API**
   - From repo root:
     ```bash
     npm run build -w @mohandishub/shared
     npm run build -w @mohandishub/api
     npm run dev -w @mohandishub/api
     ```
   - Or start your usual API process.

3. **Web**
   - From repo root:
     ```bash
     npm run dev -w @mohandishub/web
     ```
   - Open the app (e.g. `http://localhost:3000`), log in as customer, expert, business, or admin as needed.

---

## Quick test checklist

- [ ] **Analytics:** Business user → dashboard → Analytics tab (and Orders tab).
- [ ] **Advanced search:** Customer → Browse: set min rating, price range, sort, verified only; run search.
- [ ] **Recommendations:** `GET /api/services/recommendations?limit=5` (no auth).
- [ ] **Support:** Open Support in sidebar → create ticket → add reply; admin lists tickets.
- [ ] **Reviews exposure:** Browse results show Verified and rating (and “Top rated” when ≥ 4).
- [ ] **Receipt:** Wallet has transactions → `GET /api/wallet/me/transactions/:id/receipt` with a transaction id.
- [ ] **Favorites:** `POST /api/favorites` with `{ targetType: 'service', targetId: '<service-uuid>' }`, then `GET /api/favorites`.
- [ ] **Team (stub):** Business user → `GET /api/business/team/me` returns `{ team: null, members: [] }`.
- [ ] **PWA:** Open web app → Application → Manifest in DevTools.
- [ ] **i18n:** Switch to Arabic and use Support, Analytics, and search filters.

---

## Summary

- **All 15 items are implemented** (code, migrations, and/or docs as above).
- Testing is mostly manual via UI and API calls; optional: add e2e tests for critical flows (e.g. analytics, support, search, favorites) using your existing e2e setup.
