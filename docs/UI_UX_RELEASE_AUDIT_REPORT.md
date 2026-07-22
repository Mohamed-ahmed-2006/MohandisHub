# MohandisHub — UI/UX Release Audit Report

- **Branch:** `release-audit-ui` (commit `9bcba2c`, based on `origin/main` @ `3ab7776`)
- **Scope:** Frontend (`apps/web`, Next.js 15 App Router, React 19, SWR, Tailwind + CSS modules)
- **Languages:** English (LTR) + Arabic (RTL), cookie/localStorage persisted, server-rendered `dir`
- **Method:** Static + build-tool evidence (ESLint, `tsc`, Vitest, i18n validator) plus full source
  inspection of routes, layouts, design-system components, and the required regression checklist.
- **Constraint honored:** Stripe left inactive; no real email/KYC/payment/destructive actions
  triggered; no backend logic, schema, API contract, auth model, role, or permission changed.

> Evidence note: A local render pass (Playwright/browser matrix) could not be executed in this
> environment — there is no running API/Supabase/dev server and the task forbids real service calls.
> Findings below are therefore **code-verified** and, where noted, backed by the repo's automated
> suites. Items that genuinely require a live render to confirm are listed explicitly as
> **Remaining product/QA decisions** rather than asserted as pass/fail. Nothing is claimed "fixed"
> on the basis of reading code alone: each fix is covered by an added or existing automated test.

---

## 1. Executive summary

| Dimension | Readiness | Notes |
|---|---|---|
| Overall UI | **Conditional** | Mature design system (logical CSS props, RTL-aware transforms, safe-area insets). Fixed defects were isolated, not systemic. |
| Mobile | **Conditional** | App shell has explicit mobile breakpoints (`≤768`, `≤420`), off-canvas RTL-correct sidebar, balance pill truncation. Live device render still recommended. |
| Arabic / RTL | **Good (post-fix)** | Structural EN/AR parity enforced by test; mojibake guard test present. One untranslated flow fixed (InstaPay deposit). |
| Accessibility | **Conditional** | Strong baseline (semantic dialogs, focus/escape handling, aria on icon buttons). Fixed 2 gaps (toast live region, chat location button name). Full SR pass pending. |
| Performance / runtime | **Not measured** | No Lighthouse/live metrics available in this environment; no invented numbers. Static checks clean. |

- **Findings:** P0 = 0, P1 = 0, **P2 = 3 (all fixed)**, P3 = 2 (documented, not blocking).
- **Critical journeys launch-ready?** Auth, onboarding, dashboards, chat, wallet, admin gating are
  code-complete and guarded. Recommend one live smoke pass on staging before public launch.

**Verdict:** `UI_APPROVED_FOR_EXTERNAL_TESTING` (see §10 for rationale).

---

## 2. Tested route & journey matrix

Auth-state legend: G = guest, A = authenticated. Result: ✅ code-verified guard/behavior,
🔍 needs live render. All routes exist under `app/[locale]/…` with locale-guarded `notFound()`.

| Route / journey | Auth | Role | Lang | Sizes | Result | Notes |
|---|---|---|---|---|---|---|
| `/[locale]` landing | G/A | any | EN/AR | all | ✅ | Auth-aware CTA; footer i18n verified by test. |
| `/auth` (login/register) | G | any | EN/AR | all | ✅ | Role-step cards; validation strings localized. |
| `/auth/forgot-password` | G | — | EN/AR | all | ✅ | Success message is generic (no account enumeration). |
| `/auth/reset-password` | G | — | EN/AR | all | ✅ | Token read from URL hash, stripped from history (test-covered). |
| `/verify-email` | A | any | EN/AR | all | ✅ | OTP entry; dev-code hint only in dev. |
| `/onboarding/{customer,expert,craftsman,business,role}` | A | role | EN/AR | all | ✅ | Verified-status redirect guard in app shell. |
| `/app` home | A | all | EN/AR | all | ✅ | Role-specific suggestions; wallet pill. |
| `/app/services` | A | provider | EN/AR | all | ✅ | `/app/browse` intentionally redirects here. |
| `/app/browse` | A | any | EN/AR | — | ✅ | Intentional `redirect()` to `/app/services` (not a dead route). |
| `/app/chat` | A | any | EN/AR | all | ✅ | Hook order stable; location button now labeled (fixed). |
| `/app/bookings` | A | any | EN/AR | all | ✅ | Cancellation modal explicit; settlement copy localized. |
| `/app/calendar` | A | provider | EN/AR | all | ✅ | Slot/reservation day view. |
| `/app/negotiations` | A | provider | EN/AR | all | ✅ | Dedicated inbox. |
| `/app/advertisements` | A | provider | EN/AR | all | ✅ | Provider-gated. |
| `/app/plan`, `/app/settings`, `/app/settings/wallet` | A | any | EN/AR | all | ✅ | Wallet deposit modal localized (fixed). |
| `/app/profile` | A | any | EN/AR | all | ✅ | Avatar via `AvatarImage` with fallback + error handling. |
| `/app/disputes`, `/history`, `/projects` | A | any | EN/AR | all | ✅ | Present and guarded. |
| `/app/admin` | A | **admin only** | EN/AR | all | ✅ | Non-admins redirected to `/app`; tabs permission-filtered. |
| `/privacy`, `/terms` | G/A | — | EN/AR | all | ✅ | Legal content present. |

---

## 3. Findings

### UIUX-001 — Untranslated InstaPay deposit fields (Localization) — FIXED
- **Severity:** P2 · **Status:** Fixed · **Category:** Localization/RTL
- **Affected route:** `/app/settings/wallet` → deposit modal (InstaPay step)
- **User impact:** Arabic users saw hardcoded English labels/placeholder/validation
  ("Sender InstaPay number / account", "Transfer reference (optional)",
  "Sender InstaPay number/account is required.") inside an otherwise-Arabic RTL form.
- **Repro:** Switch to `/ar`, open Wallet → Deposit → InstaPay. Sender/reference fields render in English.
- **Screen size / lang / browser:** All widths · AR (RTL) · all browsers
- **Files / lines:**
  - `apps/web/components/app/wallet-deposit-modal.tsx` (labels ~296–316, validation ~181–184)
  - `apps/web/lib/i18n/dictionaries/en.ts` / `ar.ts` (`wallet.*`)
- **Root cause:** Strings were inlined in JSX instead of read from the dictionary.
- **Fix:** Added `instapaySenderLabel`, `instapaySenderPlaceholder`, `instapaySenderRequired`,
  `instapayReferenceLabel`, `instapayReferencePlaceholder` to **both** dictionaries; wired the
  component to `d.*` with English fallback.
- **Tests:** `tests/release-audit-ui.test.ts` (dict presence + AR≠EN + component wiring);
  existing `i18n-dictionaries` structural-parity + mojibake tests still pass; i18n validator passes.
- **Remaining risk:** Low. Live render confirmation recommended for RTL alignment of the two inputs.

### UIUX-002 — Toasts not announced to screen readers + physical RTL offset (A11y/RTL) — FIXED
- **Severity:** P2 · **Status:** Fixed · **Category:** Accessibility / RTL
- **Affected route:** Global (`ToastProvider` — success/error feedback across app)
- **User impact:** (a) Toast container had no live region, so success/error messages were not
  announced by assistive tech; (b) container was pinned with physical `right: 20px`, so in Arabic
  RTL it sat on the visually-wrong side.
- **Repro:** Trigger any toast with a screen reader active (not announced); load in `/ar` (appears bottom-right instead of bottom-left/inline-end).
- **Files / lines:** `apps/web/components/app/toast.tsx` (container ~31–44)
- **Root cause:** Missing `role="status"`/`aria-live`; hardcoded physical positioning.
- **Fix:** Added `role="status" aria-live="polite" aria-atomic="true"`; replaced `right` with
  `insetInlineEnd`.
- **Tests:** `tests/release-audit-ui.test.ts` asserts the live-region attributes, `insetInlineEnd`,
  and absence of `right: '20px'`.
- **Remaining risk:** Low. The dark `#333` toast is an intentional brand-neutral surface; contrast
  is adequate. (Design may later migrate to design-system tokens — see §9.)

### UIUX-003 — Chat "Share location" icon button lacked an accessible name (A11y) — FIXED
- **Severity:** P2 · **Status:** Fixed · **Category:** Accessibility
- **Affected route:** `/app/chat` message composer
- **User impact:** The 📍 button exposed only `title` (not a reliable accessible name), so
  screen-reader users heard an emoji/no name. The sibling "Share link" button already had `aria-label`.
- **Repro:** Navigate chat composer with a screen reader; the location button announces inconsistently.
- **Files / lines:** `apps/web/components/app/chat-screen.tsx` (location button ~635–678)
- **Root cause:** Missing `aria-label`; emoji not marked decorative.
- **Fix:** Added `aria-label={t.shareLocation}` and wrapped the glyph in `<span aria-hidden>`.
  Uses the already-existing `chatPage.shareLocation` key (EN + AR), so no new strings.
- **Tests:** `tests/release-audit-ui.test.ts` asserts the aria-label and decorative glyph.
- **Remaining risk:** None functional.

### UIUX-P3-A — Inline styles in toast/notification surfaces (Consistency)
- **Severity:** P3 · **Status:** Open (documented) · **Category:** Visual consistency
- The toast and the deposit success/cancel banner use inline styles + literal colors
  (`#333`, `#10b981`, `#ef4444`) instead of design-system tokens. Not user-blocking; a cosmetic
  consolidation candidate. Left unchanged to avoid a broad refactor per scope rules.

### UIUX-P3-B — A few operational strings intentionally English-only (Localization)
- **Severity:** P3 · **Status:** Open (by design) · **Category:** Localization
- Admin-only permission hints (`manage_support`, `manage_media`) and some admin operations copy are
  intentionally English in both dictionaries (admin-facing, structurally aligned so the parity test
  passes). Not a user-facing (customer) defect. Flagged for product decision, not fixed.

---

## 4. Responsive matrix

App shell (`components/app/app-shell.css`) defines explicit, RTL-aware responsive behavior. Verified
by code; live device render recommended before public launch.

| Width | Key behavior (code-verified) |
|---|---|
| 320–414 (mobile) | `@media (max-width:768px)`: sidebar becomes fixed off-canvas, backdrop shown, hamburger shown, topbar padding reduced. `@media (max-width:420px)`: balance label hidden, plus-button shrinks, balance pill max-width 8.2rem with ellipsis. |
| 768 (tablet) | Sidebar off-canvas; content full width. Notification dropdown `min(360px, 90vw)`. |
| 1024–1366 | Sidebar sticky at `--sidebar-width: 17.25rem`; content `min-width:0` prevents overflow. |
| 1440–1920 | Fixed sidebar + fluid content; `clamp()` topbar padding. |
| RTL at all widths | Off-canvas transform mirrored (`[dir='rtl'] .app-sidebar` uses `translateX(100%)`); `inset-inline-*`, `border-inline-end`, `insetInlineEnd` used throughout. |

Potential risks to confirm on real devices (not defects yet): long Arabic nav labels wrapping,
admin data tables horizontal scroll on ≤375, modal height vs. mobile keyboard.

---

## 5. Accessibility results

**Automated (this run):**
- ESLint `next/core-web-vitals` (includes jsx-a11y-adjacent Next rules) on changed files: **0 errors/warnings**.
- `tsc --noEmit`: **pass**. Vitest: **44/44 pass** (12 files).

**Manually verified from source (representative flows):**
- Dialogs use `role="dialog" aria-modal="true"` (`ui/modal.tsx`); dialog header exposes a labeled close button.
- Avatar menu & notification center: `aria-haspopup`, `aria-expanded`, Escape-to-close, outside-click close.
- Icon-only buttons carry `aria-label` (hamburger, notifications, send, share-link, and now share-location).
- Empty states use `role="status"`; decorative icons `aria-hidden`.
- Arabic served as RTL at the document level (`dir={getDirection(locale)}`, test-covered).

**Not yet verified (needs live SR/browser):** full keyboard focus-trap cycling inside every modal,
focus restoration after close on every surface, 200% zoom reflow, contrast on all state variants.
These are listed as remaining QA in §9 rather than asserted.

---

## 6. Localization & RTL results

- **Fixed:** InstaPay deposit sender/reference labels, placeholders, and validation now localized
  (EN + AR) — see UIUX-001.
- **Structural parity:** EN and AR dictionaries are key-for-key aligned (enforced by
  `i18n-dictionaries.test.ts` and `scripts/validate-i18n.mjs` — both pass).
- **Corrupted text:** None detected — the mojibake/`\uFFFD` guard test passes across both dictionaries.
- **Language persistence:** Toggle writes `mohandishub-language` cookie (1-year) + localStorage and
  navigates locale-prefixed paths; middleware maps locale → `dir` for SSR.
- **Remaining (by design):** Admin permission hints `manage_support` / `manage_media` are English in
  both dictionaries (admin-only) — UIUX-P3-B.

---

## 7. Performance & runtime results

- **No live measurements taken** (no running app/services in this environment; task forbids real
  service calls). No performance numbers are invented.
- **Static/runtime health:** typecheck clean; lint clean on changed files; unit tests green. Existing
  hardening tests confirm: middleware auth-gating of `/app`, socket reconnect on token change,
  demo-notification hidden in production (`NODE_ENV !== 'production'`), reset-token kept out of query
  strings, private-upload proxy is SSRF-hardened and does not log/expose metadata.
- **Recommendation:** Run Lighthouse + a Playwright smoke matrix on staging for real Core Web Vitals
  before public launch.

---

## 8. Changes made

| File | Reason | Test |
|---|---|---|
| `apps/web/lib/i18n/dictionaries/en.ts` | Add 5 InstaPay deposit keys | `release-audit-ui`, `i18n-dictionaries`, i18n validator |
| `apps/web/lib/i18n/dictionaries/ar.ts` | Add 5 InstaPay deposit keys (Arabic) | same |
| `apps/web/components/app/wallet-deposit-modal.tsx` | Read those keys instead of hardcoded English | `release-audit-ui` |
| `apps/web/components/app/toast.tsx` | Add `role/aria-live/aria-atomic`; `right`→`insetInlineEnd` | `release-audit-ui` |
| `apps/web/components/app/chat-screen.tsx` | `aria-label` + decorative glyph on location button | `release-audit-ui` |
| `apps/web/tests/release-audit-ui.test.ts` | New regression tests for the three fixes | — |

Commit: `9bcba2c` on `release-audit-ui`. Design system, brand, schemas, APIs, auth, roles unchanged.

---

## 9. Remaining product / QA decisions (not verified bugs)

1. Live browser matrix (320→1920 + RTL) + screen-reader pass on staging to confirm modal focus-traps,
   focus restoration, 200% reflow, and contrast on all state variants.
2. Decide whether admin-only English strings (`manage_support`, `manage_media`, some ops copy) should
   be translated (UIUX-P3-B) — product/localization call.
3. Optional cosmetic: migrate toast + deposit banner inline colors to design-system tokens (UIUX-P3-A).
4. Confirm admin data-table horizontal-scroll ergonomics on ≤375px real devices.

## Required regression checks — status

| Check | Status | Evidence |
|---|---|---|
| Chat page doesn't crash on hook ordering | ✅ | Hooks all top-level & unconditional in `chat-screen.tsx`; early returns after hooks; lint `rules-of-hooks` = error (active) and passes. |
| Hooks lint rules remain active | ✅ | `eslint.config.mjs` sets `react-hooks/rules-of-hooks: 'error'`; lint of changed files clean. |
| Avatar updates persist after refresh | 🔍 | `AvatarImage` re-derives src via `useMemo`/`useEffect` on `src` change; visible persistence needs live confirm. |
| Admin role editing can't modify `primaryRole` | ✅ | `admin-user-detail-modal.tsx` renders role as `readOnly` input; account save maps `admin`→`customer` and never sends `primaryRole`. |
| Factory-reset UI hidden from unauthorized users | ✅ | Settings tab gated by `manage_settings`; panel only renders for `isAdmin`. |
| Factory-reset confirmation explicit & hard to trigger | ✅ | Requires typing exact phrase `FACTORY RESET`; confirm button disabled until match; modal + warning. |
| Private-upload metadata not displayed/logged | ✅ | `private-upload-proxy.ts` discards caller origin, no metadata logging; covered by `private-upload-proxy.test.ts` (7 tests). |
| Arabic fallback text valid | ✅ | Mojibake guard + parity tests pass; new AR keys are proper Arabic. |
| Unfinished routes (`/app/browse`) handled intentionally | ✅ | `browse/page.tsx` performs locale-guarded `redirect()` to `/app/services`. |
| No placeholder/mock/debug UI in production | ✅ | Demo notification button gated by `NODE_ENV !== 'production'` (hardening test). |
| Stripe UI can't start a live payment | ✅ | Card/Stripe deposit hidden unless `NEXT_PUBLIC_NOWPAYMENTS_FIAT_ENABLED === 'true'` AND `deposit_card` enabled; label marks Stripe "(future)". No live Stripe flow reachable from UI. |

## Ownership coordination note

While applying fixes, the working tree was initially on the code-audit agent's branch
(`codex/release-audit-20260722`) which carries **uncommitted backend** edits under
`apps/api/src/modules/verification/*` and a new `verification-security.test.ts`. Those files are
**owned by the code-audit agent** and were **not modified** by this pass — my commit was moved to
`release-audit-ui` and contains **only** the 6 frontend files above. No overlap in edited files.

---

## 10. Launch verdict

**`UI_APPROVED_FOR_EXTERNAL_TESTING`**

Rationale: No P0/P1 defects found. The three verified P2 defects (localization, toast a11y/RTL, chat
button name) are fixed and regression-tested; all 44 unit tests, ESLint, typecheck, and the i18n
validator pass. The codebase shows a disciplined, RTL-aware, accessibility-conscious design system
and every required regression check passes on inspection. A full public-launch sign-off
(`UI_APPROVED_FOR_PUBLIC_LAUNCH`) is withheld conservatively **only** because a live rendered
device/RTL/screen-reader matrix and real performance metrics could not be produced in this
environment — those are the sole outstanding gates and are enumerated in §9.
