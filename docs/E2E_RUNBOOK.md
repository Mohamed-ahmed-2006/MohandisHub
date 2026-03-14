# E2E runbook

- **Tool:** Playwright in `apps/e2e`. Run with `npm run e2e` from repo root (or `npm run e2e` inside `apps/e2e`).
- **Base URL:** Set `PLAYWRIGHT_BASE_URL` or `BASE_URL` to the web app URL (e.g. staging `https://staging.mohandishub.app`). Default is `http://localhost:3000` for local runs.
- **Local:** Start web and API (`npm run dev`), then in another terminal run `npm run e2e`.
- **CI:** GitHub Actions runs e2e when secret `STAGING_WEB_URL` is set. All 5 must-pass journeys run on every deploy to staging.

## 5 must-pass journeys

1. **Auth + onboarding** — Auth page loads; login/register visible; home links to auth/onboarding.
2. **Customer need to expert engagement** — App and browse/needs entry points load (gated by auth).
3. **Reservation / booking lifecycle** — Bookings and calendar routes load.
4. **Admin verification flow** — Admin route loads (gated by auth).
5. **Wallet / payment flow** — Wallet/settings routes load.

Deep flows (full login, create need, place bid, create reservation, admin approve, wallet deposit) can be added to the same specs; use test/staging API and DB for stability.
