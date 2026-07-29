# 07 — Search, Dashboard and Navigation Audit

---

## 1. Search

### 1.1 What exists

**`GET /api/services/search`** is the only full-featured search endpoint, and it is class 1:

| Facet | Supported |
|---|---|
| Free text (`query`) | ✅ |
| Category | ✅ |
| City / area | ✅ |
| Provider type (expert/business/craftsman) | ✅ |
| Min rating | ✅ |
| Price range | ✅ |
| Verified only | ✅ |
| Sort | ✅ 5 options |
| Pagination | ✅ |

Supporting capabilities, all class 1: `saved_searches` (table + routes + UI, wired at `app-home-screen.tsx:431`), recommendations with explicit consent and event recording, favorites, and `service_view_events` with aggregate triggers.

### 1.2 What is weak

| Facet | Class | Note |
|---|---|---|
| **Tags** | 6 | `tags TEXT[]` with a GIN index exists on `services` and is **not exposed as a filter**. The index is built and unused |
| Specialties | 6 | Profile data not searchable |
| Service area (radius) | 6 | Only exact city/area match |
| Availability | 6 | `reservation_slots` exist; not a filter |
| Experience | 6 | Profile field, not searchable |
| Needs search | 4 | `GET /api/needs` lacks a comparable filter set |
| Provider/people search | 4 | Only reachable indirectly via services |

**Adding tag filtering is the cheapest high-value search improvement available** — the column, the data and the index all already exist.

### 1.3 Result cards are duplicated

There is no shared result-card component. Card markup is inline inside `app-home-screen.tsx`, with role branching:

```tsx
authUser.role === 'business' && businessSearchMode === 'needs' ? … : …
```

This pattern repeats at lines 1582, 1679, 1690, 1707, 1718, 1731, 1736, 1773, 1806, 1820, 1825. Each is a separate ternary choosing between "search needs" and "search services" for the same UI slot.

**Consolidation proposal** — one component, role-aware actions passed in:

```tsx
<ResultCard
  kind="service" | "need" | "provider"
  data={result}
  actions={actionsForWorkspace(workspace, result)}
/>
```

`actionsForWorkspace` returns `[Book, Negotiate, Favorite]` for a customer workspace and `[Bid, Save, Hide]` for a provider workspace. **Role branching moves from eleven inline ternaries into one function.**

### 1.4 Recommendations

`recommendations` module records view/click events with consent (`getConsent` / `setConsent` in the profile screen). The brief cautions against introducing an AI recommendation system before the data model is stable — **correct, and already respected.** The current implementation is rules-based over recorded events. Keep it that way; the transparent inputs (category, tags, location, budget, recent activity) are sufficient and explainable.

---

## 2. Dashboards

### 2.1 The monolith

`app-home-screen.tsx` is **2,430 lines** and contains: routing logic, need posting, service search, needs search, saved searches, recommendations, three dashboard mounts, service detail, the booking modal, and the negotiation modal.

Role branching (`authUser.role === …`) occurs at 20+ points. Adding a workspace concept to this file as-is would double the branching. **Splitting it is a prerequisite for the workspace work, not a cleanup nicety.**

Suggested split — no behaviour change, pure extraction:

```
app-home-screen.tsx        → routing + workspace resolution only
discovery/search-panel.tsx → search + filters + saved searches
discovery/result-card.tsx  → the shared card (§1.3)
discovery/service-detail.tsx
needs/post-need-panel.tsx
dashboards/*               → already separate; keep
```

### 2.2 Customer dashboard vs. required

| Required | Class |
|---|---|
| Needs awaiting proposals | 1 |
| Proposals awaiting review | 4 — bid count shown, no comparison entry |
| **Awards awaiting activation** | 6 — customer cannot see they are waiting on the provider |
| Active projects | 4 |
| **Deliverables awaiting approval** | 6 — feature absent |
| Unread messages | 1 |
| **Open support cases** | 6 |

### 2.3 Provider dashboard vs. required

| Required | Class |
|---|---|
| Relevant opportunities | 4 — list exists, no relevance ranking |
| Draft/submitted proposals | 1 |
| **Awards awaiting activation** | 2 — `AwardOfferCard` exists and works; **not surfaced on the dashboard** |
| Active projects | 4 |
| Upcoming milestones | 6 |
| Profile completion | 6 |
| **MHC balance and recent usage** | 5 — dashboard shows the **frozen EGP balance**, not MHC |
| Pending reviews | 6 |

`award-offer-card.tsx` (222 lines) is a well-built component for the single most important provider action — accept and activate. It renders inside the needs flow but not on the dashboard, so a provider must go looking for a time-limited, revenue-generating offer.

### 2.4 Business dashboard vs. required

`business-dashboard.tsx` has tabs: `overview | services | orders | analytics | jobs | team`.

| Required | Class |
|---|---|
| Sales pipeline | 4 — orders tab |
| **Procurement activity** | 6 — a business cannot buy (see `02`) |
| Team workload | 4 — team panel lists members, no workload |
| Services | 1 |
| Projects | 4 |
| Subscription state | 4 |
| **MHC state** | 6 |
| Analytics summary | 2 — works; tab-only |

**Sales and procurement are not separated because procurement does not exist.** This is downstream of the role model, not a dashboard defect.

### 2.5 Business analytics needs its own route

`GET /api/analytics/me` is class 1 with `requireRole('expert','business','craftsman')`. The UI is a tab inside the business dashboard — not linkable, not bookmarkable, not deep-linkable from a notification.

**Fix:** add `/app/analytics` with its own guard. Small, self-contained, no schema change. The API is already correct.

---

## 3. Navigation

### 3.1 Current model

`app-sidebar.tsx` holds a hardcoded 13-item array filtered by:

1. `hiddenHrefs` from `app_settings.sidebar_hidden_hrefs` (class 1 — admin control)
2. `featurePlansEnabled` for `/app/plan`
3. `item.roles.some(r => r === userRole)`

### 3.2 Problems

**Two important surfaces are unreachable.**

| Route | Contains | In sidebar |
|---|---|---|
| `/app/profile` | **`MhcCreditsScreen`** — balance, packages, purchase, history | ❌ |
| `/app/projects` | Employment jobs workspace | ❌ |

The MHC screen is the launch revenue mechanism. It is buried at `profile-screen.tsx:928` while the frozen EGP balance has a permanent header pill. **This inversion is the single clearest symptom of the incomplete migration.**

**Navigation is role-based, not capability-based.** `roles: ['expert','craftsman','business']` is repeated on four items. When workspaces arrive, this becomes wrong: a business owner in their customer workspace should not see "My Catalogue".

**Route guards do not match sidebar visibility.** `/app/services` is hidden from customers but has no route guard — direct navigation renders the screen. The API rejects writes, so this is a UX defect rather than a security hole, but hidden routes must still be guarded at the route layer.

**Terminology is misleading.** "Projects" → employment jobs. "My Services" → the provider's own catalogue, not browsing. "Browse" → a dead redirect.

### 3.3 Proposed capability-driven navigation

Replace the role array with declared capabilities:

```ts
type NavItem = {
  href: string;
  labelKey: string;
  capability: Capability;   // not roles
};

const NAV: NavItem[] = [
  { href: '/app',            labelKey: 'nav.home',       capability: 'always' },
  { href: '/app/needs',      labelKey: 'nav.needs',      capability: 'post_needs' },
  { href: '/app/opportunities', labelKey: 'nav.opportunities', capability: 'submit_bids' },
  { href: '/app/catalogue',  labelKey: 'nav.myCatalogue', capability: 'manage_services' },
  { href: '/app/work',       labelKey: 'nav.myWork',     capability: 'always' },
  { href: '/app/credits',    labelKey: 'nav.credits',    capability: 'hold_mhc' },
  { href: '/app/analytics',  labelKey: 'nav.analytics',  capability: 'view_analytics' },
  { href: '/app/team',       labelKey: 'nav.team',       capability: 'manage_team' },
  { href: '/app/help',       labelKey: 'nav.help',       capability: 'always' },
];
```

`capabilitiesForWorkspace(workspace)` returns the set. **The same function must gate the route guard**, so visibility and access cannot drift.

Interim step before workspaces land: keep role filtering, but **add `/app/credits` for providers and rename the misleading items**. That is a small change with immediate benefit.

### 3.4 Header

| Current | Proposed |
|---|---|
| EGP balance pill for all roles | MHC pill for provider workspaces; nothing for customer workspaces |
| `+` → empty deposit modal | `+` → buy MHC (providers only) |
| — | Workspace switcher (once workspaces exist) |

---

## 4. Mobile and RTL

**RTL** is handled properly: logical CSS properties (`marginInlineStart`), `[locale]` routing, `html-lang-sync`, and `validate-i18n.mjs` in CI. Class 1.

**Hardcoded English strings** remain in several components — `formatStatus` in `wallet-settings-screen.tsx:29`, deposit-modal fallback errors, `projects-screen.tsx` inline ternaries, and every notification producer (see `06` §5.2). These render as English inside an otherwise Arabic UI.

**Mobile:** the sidebar has a proper drawer with backdrop. Not audited on device — flagged as unverified rather than passed.

---

## 5. Recommended order

1. Add `/app/credits` to the sidebar; add the MHC header pill *(small, immediate)*
2. Rename "Projects" → "Hiring"; "My Services" → "My Catalogue"; delete the `/app/browse` redirect *(small)*
3. Add `/app/analytics` with a guard *(small)*
4. Expose tag filtering in search *(small — index already exists)*
5. Surface `AwardOfferCard` on the provider dashboard *(small, high value)*
6. Extract `ResultCard` and the search panel from the monolith *(medium)*
7. Add route guards matching sidebar visibility *(medium)*
8. Capability-driven navigation *(medium — after workspaces)*
