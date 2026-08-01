# Wave 2 Frontend — Visual & Interaction QA Audit

**Date:** 2026-08-01
**Baseline:** `origin/main` @ `417d9112d5ea2f702217e61ad7a1748ff20ff8b4`
**Auditor:** Antigravity (static code + dictionary analysis; canonical domain intentionally in maintenance mode)
**Branch:** `audit/wave-2-visual-qa`
**Build command:** `npm run dev` in `apps/web` (port 3000)

---

## Scope

| Surface | Routes audited |
|---|---|
| Advertisements – provider | `/[locale]/app/advertisements` |
| Advertisements – admin | `/[locale]/app/admin` → Advertisements tab |
| Team administration | `/[locale]/app` → Business dashboard → Team tab |
| Help & Resolution | `/[locale]/app/help-resolution` and `/[locale]/app/support` |

Viewports: desktop 1280 px, mobile 375 px × locales EN + AR (RTL).

---

## Finding Index

| ID | Surface | Severity | Title |
|---|---|---|---|
| W2-01 | Ads – Admin | **Medium** | `pending_payment` status missing from admin filter dropdown |
| W2-02 | Ads – Admin | **Medium** | Admin table renders raw `status` token with no human-readable label |
| W2-03 | Ads – Admin | **Medium** | Admin modal lacks `role="dialog"` / focus-trap — keyboard escapes |
| W2-04 | Ads – Admin | **Low** | Admin overview copy says "one price per day" — pricing is per-campaign |
| W2-05 | Ads – Provider | **Medium** | Image-remove button uses physical `right: 0.5rem` — wrong in RTL |
| W2-06 | Ads – Provider | **Low** | Form-actions `justify-content: flex-end` may feel reversed in AR |
| W2-07 | Ads – Provider | **Low** | `pending_payment` and `paused_by_admin` share identical badge colour |
| W2-08 | Ads – Provider | **Low** | No billing period history or renewal state surfaced to the provider |
| W2-09 | Ads – Provider | **Info** | Duplicate "Create Ad" entry point analysis (no functional bug) |
| W2-10 | Help & Resolution | **Medium** | `support-screen.css` not imported in `help-resolution-screen.tsx` |
| W2-11 | Help & Resolution | **Medium** | New-case panel has no focus trap — Tab key escapes |
| W2-12 | Help & Resolution | **Medium** | `unavailableNotice` leaks internal API contract path to users |
| W2-13 | Help & Resolution | **Low** | "Safety & Payments" tab translated as "السياسة والدفع" (Policy & Payment) |
| W2-14 | Help & Resolution | **Low** | Status pills render raw DB token (e.g. `resolved_refunded`) |
| W2-15 | Help & Resolution | **Low** | `ChevronLeft` back icon always points left — wrong in RTL mobile |
| W2-16 | Help & Resolution | **Low** | Evidence file input has no accessible label |
| W2-17 | Help & Resolution | **Info** | Two routes render `HelpResolutionScreen`; sidebar points to the legacy one |
| W2-18 | Team Admin | **Medium** | Permission checkboxes render raw machine key (e.g. `manage_support_disputes`) |
| W2-19 | Team Admin | **Medium** | Member row falls back to `userId.slice(0, 8)` — UUID fragment shown to users |
| W2-20 | Team Admin | **Low** | Invite status cell renders raw `status` token without label or colour |
| W2-21 | Team Admin | **Low** | No empty-state when members table has 0 rows |
| W2-22 | Team Admin | **Low** | Locale detection uses fragile Arabic character regex on `dictionary.nav.home` |
| W2-23 | Team Admin | **Info** | No workspace selector — documented deferred gap from Wave 2G-A/2G-B split |
| W2-24 | Cross-cutting | **Low** | Deposit toast uses physical `right: 20px` inline style — wrong in RTL |
| W2-25 | Cross-cutting | **Info** | Tab empty-state uses search-oriented copy ("No matching cases found") |

**Total: 0 Critical · 9 Medium · 11 Low · 5 Info**

---

## Detailed Findings

---

### W2-01 · Ads – Admin · Medium
**`pending_payment` status missing from admin filter dropdown**

| Field | Value |
|---|---|
| Route | `/[locale]/app/admin` → Advertisements tab |
| Locale | All |
| Viewport | Desktop 1280 px |

**Reproduction:** Open Admin → Advertisements. The status filter `<select>` offers All / Active / Paused / Expired / Cancelled. The `pending_payment` value is absent.

**Expected:** A "Pending payment" option so an admin can isolate campaigns awaiting their first MHC charge.

**Actual:** Filtering by `pending_payment` is impossible; affected campaigns are invisible unless "All statuses" is selected.

**Code location:** `apps/web/components/admin/admin-ads-tab.tsx` L228–233

```tsx
// Missing:
// <option value="pending_payment">Pending payment</option>
```

**Severity:** Medium — admin cannot triage campaigns that failed the first billing cycle.

---

### W2-02 · Ads – Admin · Medium
**Admin table renders raw `status` enum token**

| Field | Value |
|---|---|
| Route | `/[locale]/app/admin` → Advertisements tab |
| Locale | All |
| Viewport | Desktop 1280 px |

**Reproduction:** Look at the Status column of any campaign row.

**Expected:** Human-readable label (e.g. "Paused by Admin") with a coloured badge.

**Actual:** Raw enum value — `paused_by_admin`, `pending_payment`, etc. — rendered verbatim.

**Code location:** `apps/web/components/admin/admin-ads-tab.tsx` L270

```tsx
<td>{ad.status}</td>   // no label map
```

**Severity:** Medium — confusing for non-developer admins.

---

### W2-03 · Ads – Admin · Medium
**Admin Schedule / Pricing modals lack focus trap**

| Field | Value |
|---|---|
| Route | `/[locale]/app/admin` → Advertisements tab |
| Locale | All |
| Viewport | Desktop 1280 px |

**Reproduction:** Click "Schedule" or "Pricing" on a campaign row. Modal overlay opens. Press Tab.

**Expected:** Focus cycles only inside the modal; Escape closes it.

**Actual:** The overlay `<div>` has no `role="dialog"`, `aria-modal="true"`, or keyboard-trap logic. Tab reaches background elements; Escape does nothing (only backdrop click closes).

**Code location:** `apps/web/components/admin/admin-ads-tab.tsx` L343–379

**Severity:** Medium — keyboard accessibility failure inside a privileged workflow.

---

### W2-04 · Ads – Admin · Low
**Admin overview copy says "one price per day" — contradicts per-campaign pricing**

| Field | Value |
|---|---|
| Route | `/[locale]/app/admin` → Advertisements tab |
| Locale | EN |
| Viewport | Desktop 1280 px |

**Reproduction:** Read the description under "Overview & Ad Controls".

**Actual:** "Global controls: enable/disable accepting ads and set one price per day." The "per day" phrase is stale relative to the per-campaign MHC billing model.

**Code location:** `apps/web/components/admin/admin-ads-tab.tsx` L136–137

**Severity:** Low — misleading copy; no functional impact.

---

### W2-05 · Ads – Provider · Medium
**Image-remove button uses physical `right: 0.5rem` — wrong in RTL**

| Field | Value |
|---|---|
| Route | `/[locale]/app/advertisements` |
| Locale | Arabic |
| Viewport | Desktop 1280 px · Mobile 375 px |

**Reproduction:** Switch to Arabic, open Create Ad, upload a banner image. Observe the × remove button.

**Expected:** Button at `inset-inline-end` corner (top-right LTR → top-left RTL).

**Actual:** CSS uses `right: 0.5rem` (physical), placing the button at the physical-right edge in both LTR and RTL. Under RTL this is the wrong (start) side.

**Code location:** `apps/web/app/my-ads.css` L234–237

```css
.myads-upload-remove {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;  /* ← should be inset-inline-end: 0.5rem */
}
```

**Fix:** Replace `right: 0.5rem` with `inset-inline-end: 0.5rem`.

**Severity:** Medium — visible regression in the AR ad-creation flow.

---

### W2-06 · Ads – Provider · Low
**Form-actions `justify-content: flex-end` may feel reversed in AR**

| Field | Value |
|---|---|
| Route | `/[locale]/app/advertisements` |
| Locale | Arabic |
| Viewport | Desktop 1280 px |

**Observation:** Flexbox reverses child order in RTL (`dir="rtl"`), so the primary action button ends up visually first (leftmost) in Arabic. This is a cosmetic ordering concern, not a layout break. The buttons are not clipped.

**Code location:** `apps/web/app/my-ads.css` L282–287

**Severity:** Low — cosmetic; primary/secondary ordering may feel inverted in AR.

---

### W2-07 · Ads – Provider · Low
**`pending_payment` and `paused_by_admin` share the same badge colour**

| Field | Value |
|---|---|
| Route | `/[locale]/app/advertisements` |
| Locale | All |
| Viewport | Desktop 1280 px |

**Actual:** Both map to `dashboard-badge--pending` (amber). A provider cannot distinguish "I still need to pay" from "an admin paused this".

**Code location:** `apps/web/components/app/advertisements/my-ads-screen.tsx` L27–33

```tsx
const STATUS_COLORS = {
  pending_payment: 'dashboard-badge--pending',
  ...
  paused_by_admin: 'dashboard-badge--pending',  // same
};
```

**Severity:** Low — UX clarity issue; no functional breakage.

---

### W2-08 · Ads – Provider · Low
**No billing period history or renewal state surfaced to the provider**

| Field | Value |
|---|---|
| Route | `/[locale]/app/advertisements` |
| Locale | All |
| Viewport | Desktop 1280 px |

**Observation:** The Wave 2 spec references "period history" and "paused/awaiting-credit states". The `Advertisement` client type has no `billingPeriods` field; `AdStatus` has no `awaiting_credit` value. No UI exists for viewing which weeks were billed or which renewal attempts are pending.

**Code location:** `apps/web/lib/advertisements/client.ts` L8–35

**Severity:** Low — gap between spec and delivered UI; not a regression but a missing surface.

---

### W2-09 · Ads – Provider · Info
**"Create Ad" button duplicate entry-point analysis**

**Observation:** The header "+ Create Ad" button hides when `showForm === true`. The empty-state "+ Create Ad" button is guarded by `rows.length === 0 && !showForm`. Both conditions prevent simultaneous visibility. No functional duplicate entry point exists.

**Severity:** Info — no action needed.

---

### W2-10 · Help & Resolution · Medium
**`support-screen.css` not imported in `help-resolution-screen.tsx`**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` and `/[locale]/app/support` |
| Locale | All |
| Viewport | All |

**Reproduction:** Load `/[locale]/app/help-resolution` on a fresh build where `support-screen.tsx` is not in the same chunk.

**Expected:** `help-resolution-screen.tsx` self-sufficiently imports all CSS it uses.

**Actual:** The file imports only `@/app/dashboard.css`. All `.support-layout`, `.support-inbox`, `.support-thread`, `.support-bubble`, etc. classes are defined in `./support-screen.css` (a sibling file). These styles resolve today only because Next.js currently bundles both components together. Under a different chunking strategy, the CSS silently drops.

**Code location:** `apps/web/components/app/help-resolution-screen.tsx` — compare with `support-screen.tsx` L21–22 which imports both CSS files.

**Fix:** Add `import './support-screen.css';` to `help-resolution-screen.tsx`.

**Severity:** Medium — latent rendering failure; trivial one-line fix.

---

### W2-11 · Help & Resolution · Medium
**New-case panel has no focus trap**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` |
| Locale | All |
| Viewport | Desktop 1280 px |

**Reproduction:** Click "New Ticket / Dispute". The inline panel opens. Press Tab repeatedly.

**Expected:** Focus cycles inside the panel; Escape closes it.

**Actual:** The panel is a plain `<div>` with no `role="dialog"`, `aria-modal`, or keyboard focus management. Tab exits to background elements.

**Code location:** `apps/web/components/app/help-resolution-screen.tsx` L459–566

**Severity:** Medium — accessibility regression in the primary user creation workflow.

---

### W2-12 · Help & Resolution · Medium
**`unavailableNotice` leaks internal API contract path to users**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` |
| Locale | EN & AR |
| Viewport | Desktop 1280 px |

**Reproduction:** Open New Ticket. Choose category "Need / Job Order Issue" or "Direct Payment / Settlement Issue". Read the warning.

**Expected:** User-friendly: "This case type is not yet available. Please use General Support."

**Actual (EN excerpt):**
> Standalone case creation for "need_job_dispute" is pending backend API deployment (Contract: POST /api/v1/help-resolution/job-disputes). Please use General Support…

This exposes: the internal enum token (`need_job_dispute`), the planned API path, and the phrase "backend API deployment" — none of which are meaningful to an end user.

**Code location:** `apps/web/components/app/help-resolution-screen.tsx` L334–340

**Severity:** Medium — implementation detail language reaching users; confusing and unprofessional.

---

### W2-13 · Help & Resolution · Low
**"Safety & Payments" translated as "السياسة والدفع" (Policy & Payment)**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` |
| Locale | Arabic |
| Viewport | Desktop 1280 px · Mobile 375 px |

**Actual:** The fourth tab inline translation is `'السياسة والدفع'`. "السياسة" means "policy / politics", not "safety" (السلامة). The meaning diverges meaningfully from the English label.

**Code location:** `apps/web/components/app/help-resolution-screen.tsx` L451

```tsx
{tr('Safety & Payments', 'السياسة والدفع')}
// Should be: 'السلامة والدفع' or 'الأمان والمدفوعات'
```

**Severity:** Low — translation error; no functional impact.

---

### W2-14 · Help & Resolution · Low
**Status pills render raw DB tokens**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` |
| Locale | All |
| Viewport | Desktop 1280 px · Mobile 375 px |

**Actual:** `c.status` is rendered directly — raw values like `resolved_refunded`, `resolved_released`, `waiting_reply` appear verbatim.

**Expected:** Human-readable localised labels (compare `support-screen.tsx` which has a `statusLabel()` function).

**Code location:** `apps/web/components/app/help-resolution-screen.tsx` L644

```tsx
<span className="support-pill">{c.status}</span>  // raw token
```

**Severity:** Low — stale machine-token shown to users.

---

### W2-15 · Help & Resolution · Low
**`ChevronLeft` back icon always points left — wrong in RTL mobile**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` |
| Locale | Arabic |
| Viewport | Mobile 375 px |

**Actual:** `<ChevronLeft>` is hardcoded. In Arabic RTL, the back button should point right (toward the list direction).

**Fix:** Conditionally render `ChevronRight` in RTL, or use CSS `transform: scaleX(-1)` on `[dir="rtl"]`.

**Code location:** `apps/web/components/app/help-resolution-screen.tsx` L673

**Severity:** Low — cosmetic directional error.

---

### W2-16 · Help & Resolution · Low
**Evidence file input has no accessible label**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` (reservation dispute thread view) |
| Locale | All |
| Viewport | Desktop 1280 px |

**Actual:** The `type="file"` input has no `<label>` association and no `aria-label`. Screen readers announce it as "Choose File" without context.

**Code location:** `apps/web/components/app/help-resolution-screen.tsx` L738–743

**Severity:** Low — accessibility gap; not a launch blocker.

---

### W2-17 · Help & Resolution · Info
**Two routes render `HelpResolutionScreen`; sidebar points to the legacy one**

**Observation:**
- `/[locale]/app/support` → `HelpResolutionScreen` with `defaultTab="support"` (legacy route)
- `/[locale]/app/help-resolution` → `HelpResolutionScreen` with `defaultTab="all"` (Wave 2 canonical route)

The sidebar only exposes the `/app/support` link. The canonical Wave 2 route is live but unreachable from navigation.

**Recommendation:** Update the sidebar to link to `/app/help-resolution` and remove or redirect `/app/support`.

**Severity:** Info — no user-visible duplicate; but the sidebar is pointing at the pre-Wave-2 URL.

---

### W2-18 · Team Admin · Medium
**Permission checkboxes render raw machine key**

| Field | Value |
|---|---|
| Route | `/[locale]/app` → Business dashboard → Team tab → Create Role |
| Locale | All |
| Viewport | Desktop 1280 px · Mobile 375 px |

**Actual:** Permission chips display `manage_team`, `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`, `manage_support_disputes`, `view_analytics`.

**Code location:** `apps/web/components/app/business-team-panel.tsx` L136–141

```tsx
{BUSINESS_TEAM_PERMISSIONS.map((permission) => (
  <label key={permission} className="dashboard-chip">
    <input name={permission} type="checkbox" />
    {permission}   // ← raw key, not a label
  </label>
))}
```

**Fix:** Add a `PERMISSION_LABELS` record mapping each key to a human-readable string and render that instead.

**Severity:** Medium — shown to business owners creating roles; confusing and unprofessional.

---

### W2-19 · Team Admin · Medium
**Member row falls back to `userId.slice(0, 8)` — UUID fragment shown to users**

| Field | Value |
|---|---|
| Route | `/[locale]/app` → Business dashboard → Team tab |
| Locale | All |
| Viewport | Desktop 1280 px |

**Actual:** When `displayName` is null the member name cell shows the first 8 characters of the user's UUID.

**Code location:** `apps/web/components/app/business-team-panel.tsx` L162

```tsx
<td>{member.displayName ?? member.userId.slice(0, 8)}</td>
```

**Fix:** Fall back to `member.email ?? d.common?.unknownUser ?? 'Unknown Member'` instead of the UUID.

**Severity:** Medium — raw internal ID exposed to non-admin users.

---

### W2-20 · Team Admin · Low
**Invite status cell renders raw token**

| Field | Value |
|---|---|
| Route | `/[locale]/app` → Business dashboard → Team tab → Invitations table |
| Locale | All |
| Viewport | Desktop 1280 px |

**Actual:** `<td>{row.status}</td>` — raw string `pending`, `accepted`, `revoked` without labels or colour coding.

**Code location:** `apps/web/components/app/business-team-panel.tsx` L187

**Severity:** Low — stale machine-token shown to users.

---

### W2-21 · Team Admin · Low
**No empty-state when members table has 0 rows**

| Field | Value |
|---|---|
| Route | `/[locale]/app` → Business dashboard → Team tab |
| Locale | All |
| Viewport | Desktop 1280 px · Mobile 375 px |

**Actual:** An empty `<tbody>` is rendered with no message. Visually looks like a broken table.

**Code location:** `apps/web/components/app/business-team-panel.tsx` L150–168

**Severity:** Low — empty-state UX gap.

---

### W2-22 · Team Admin · Low
**Locale detection uses fragile Arabic character-range regex on `dictionary.nav.home`**

| Field | Value |
|---|---|
| Route | `/[locale]/app` → Business dashboard → Team tab |
| Locale | Arabic |
| Viewport | All |

**Observation:** `BusinessTeamPanel` infers locale by testing `/[\u0600-\u06FF]/.test(dictionary.nav?.home ?? '')`. If the dictionary key is renamed or the nav section is restructured, the component silently falls back to English regardless of locale.

**Expected:** Accept `locale` as a prop (as `MyAdsScreen` does).

**Code location:** `apps/web/components/app/business-team-panel.tsx` L20–21

**Severity:** Low — fragile but not currently broken.

---

### W2-23 · Team Admin · Info
**No workspace selector — documented deferred gap**

**Observation:** The Wave 2 spec lists a "workspace selector". Per commit `docs(teams): record the 2G-A/2G-B split and what is not available`, multi-workspace selection was explicitly deferred. Business owners see only their own team. This is a known, scoped gap — not a regression.

**Severity:** Info — acknowledged deferred feature.

---

### W2-24 · Cross-cutting · Low
**Deposit toast uses physical `right: 20px` — wrong in RTL**

| Field | Value |
|---|---|
| Route | Any authenticated app route after a wallet deposit |
| Locale | Arabic |
| Viewport | Desktop 1280 px |

**Actual:** Inline style `right: '20px'` positions the toast at the physical right edge. In RTL this is the visual left, which may overlap the sidebar.

**Code location:** `apps/web/components/app/app-shell.tsx` L262–268

```tsx
style={{
  position: 'fixed',
  bottom: '20px',
  right: '20px',   // ← should be insetInlineEnd: '20px'
```

**Severity:** Low — cosmetic RTL placement issue.

---

### W2-25 · Cross-cutting · Info
**Tab empty-state uses search-oriented copy**

| Field | Value |
|---|---|
| Route | `/[locale]/app/help-resolution` |
| Locale | EN & AR |
| Viewport | All |

**Observation:** When an active tab (e.g. "Marketplace Disputes") has no cases, the copy reads "No matching cases found." — implying a search failed. The user did not search; the tab simply has no results.

**Expected:** Tab-specific copy like "You have no marketplace disputes yet."

**Severity:** Info — copy improvement only.

---

## Launch Blocking Assessment

> **No Critical (launch-blocking) defect was found in this static audit.**

All findings are Medium or lower. The nine Medium items are recommended for resolution before Wave 2 release.

### Recommended Pre-Launch Fixes (Medium)

| ID | File | One-liner fix |
|---|---|---|
| W2-01 | `admin-ads-tab.tsx` | Add `<option value="pending_payment">` to status filter |
| W2-02 | `admin-ads-tab.tsx` | Map `ad.status` to a human-readable label in the table |
| W2-03 | `admin-ads-tab.tsx` | Add `role="dialog"` + focus-trap to Schedule / Pricing modals |
| W2-05 | `my-ads.css` | Replace `right: 0.5rem` with `inset-inline-end: 0.5rem` |
| W2-10 | `help-resolution-screen.tsx` | Add `import './support-screen.css'` |
| W2-11 | `help-resolution-screen.tsx` | Add focus-trap to new-case panel or convert to `<dialog>` |
| W2-12 | `help-resolution-screen.tsx` | Replace developer-facing `unavailableNotice` with user-friendly copy |
| W2-18 | `business-team-panel.tsx` | Map permission keys to human-readable labels |
| W2-19 | `business-team-panel.tsx` | Replace `userId.slice(0, 8)` with email or "Unknown Member" |

---

## RTL Summary

| Check | Result |
|---|---|
| Horizontal overflow | None observed in static review |
| Clipped text | None observed |
| Flex/grid RTL order | Generally correct — auto-reversed by `dir="rtl"` |
| Physical `right`/`left` in CSS | **2 instances** (W2-05, W2-24) |
| Directional icons hardcoded | **1 instance** (W2-15 — `ChevronLeft`) |
| Translation error | **1 instance** (W2-13 — "Safety" → "السياسة") |

---

## Methodology Note

This audit was performed as a **static source analysis** — no live dev server output was available (canonical domain in maintenance mode; local `npm run dev` not started during this pass). All findings are backed by direct code citations. A follow-up **live browser pass** at `localhost:3000` is strongly recommended to:

1. Confirm visual rendering of all Medium RTL findings (W2-05, W2-24).
2. Verify the CSS chunk-splitting behaviour (W2-10) under a production-like build (`npm run build`).
3. Exercise keyboard Tab flow on the admin modals (W2-03) and new-case panel (W2-11).

---

*Audit performed by Antigravity · 2026-08-01 · Reviewed commit: `417d9112`*
