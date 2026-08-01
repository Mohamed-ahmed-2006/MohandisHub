# Wave 2I independent review and final integration

Date: 2026-08-01

Integration branch: `integration/wave-2i-final`

Integration base: `origin/main` at `cd29dbaf9aa6ac465854aa5078f75ac0dfcc3eb9`

Reviewed feature tip: `3f6e8790eaa584631d2835bd280c55c66c18556f`

Reviewed visual-polish tip: `bfafde3d53cc16c3a87fe111af79efc0b34109b4`

Pending migration: `20260801090000_unified_help_resolution_cases.sql`

## Executive verdict

Wave 2I is mergeable after the focused corrections recorded below. The legacy
support and reservation-dispute engines remain authoritative; the new
`resolution_cases` table is a synchronized spine, not a replacement settlement
engine. Native need/job, direct-payment and safety cases use the new message,
evidence and timeline tables.

No production migration was applied and no production row was written. The
deployment target remains at 102 applied migrations; Wave 2I is the sole pending
migration. The migration dry-run applied and rolled it back successfully against
current production data. Clean replay matched the live 102-migration schema
boundary exactly and replayed all 103 repository migrations.

## Git source of truth

`git log --oneline b2d146e..origin/feat/wave-2i-backend-integration` contains
16 commits, not the reported 14:

1. `547bf84` docs(help): define unified resolution frontend contracts
2. `0adb57b` feat(web): add help and resolution center
3. `21b903a` feat(web): add case details and evidence presentation
4. `11db75f` test(web): cover help and resolution states
5. `d60d3c4` feat(db): add a unified resolution case spine beside the old engines
6. `771a0ed` feat(shared): add unified help & resolution case types
7. `e419576` feat(api): serve every case kind from one help & resolution surface
8. `da16917` fix(upload): authorise case evidence against the case, not caller input
9. `18da6b2` feat(shared): route unified case notifications
10. `7399453` feat(web): add help & resolution dictionary entries
11. `f167171` feat(web): give the merged centre a single navigation entry
12. `4b6e8e2` feat(web): drive the help centre from the unified case API
13. `8682f69` test: cover the unified centre with PostgreSQL and HTTP
14. `0cef9fe` docs(help): record the delivered backend contract
15. `b0f1c8d` fix(help): refuse unsafe support internal notes
16. `3f6e879` fix(help): make native message/timeline/status atomic

All 16 were cherry-picked in order. There were no conflicts. Git performed
routine clean auto-merges in the English and Arabic dictionaries.

Antigravity's polish commit `bfafde3` was then cherry-picked as `278981e`.
Its parent/merge base is exactly Claude's reviewed tip `3f6e879`. The help
resolution screen had one content conflict because the integration branch had
already preserved canonical engine status/outcome display and renamed the
shared stylesheet. The resolution kept Claude's unified API, private-evidence
flow, availability rules and historical link handling while retaining the
polished master/detail presentation, metrics, badges, mobile rules, RTL and
dictionary additions. Git followed the earlier stylesheet rename to
`case-thread.css` automatically. No backend file conflicted or changed.

## Architecture and adapter verdict

The adapter is coherent and safe:

- `support_tickets` and `support_ticket_messages` remain the platform-support
  source of truth.
- `reservation_disputes`, notes and evidence remain the reservation-dispute
  source of truth. The existing reservation resolver remains the only settlement
  path.
- `resolution_cases` supplies common identity, visibility, status projection,
  assignment, escalation and activity fields.
- Native kinds use `resolution_case_messages`, `resolution_case_evidence` and
  `resolution_case_events`.
- `resolution_sync_support_ticket()` handles support insert/update; the support
  message trigger touches spine activity.
- `resolution_sync_reservation_dispute()` handles dispute insert/update; note
  and evidence triggers touch spine activity.
- The triggers write only legacy-to-spine. No spine-to-legacy trigger exists,
  so there is no trigger cycle.
- Unique legacy foreign keys plus `ON CONFLICT` upserts and `NOT EXISTS`
  backfills enforce one spine row per legacy row.
- Deleting a legacy authoritative row cascades to its spine row. Native child
  messages/evidence/events cascade when their case is deleted.
- Status, assignment, resolution metadata and `updated_at` remain synchronized.
  Reopening a support ticket clears stale unified resolution metadata.
- Re-running the migration drops/recreates only its triggers and idempotently
  upserts/backfills without duplicating spine rows.

The generic resolver refuses reservation disputes with
`RESOLUTION_HANDLED_ELSEWHERE`; it cannot bypass refund, capture, release or
split-settlement rules.

## Authorization matrix

| Case type            | User access                                                                        | Counterparty lifecycle                                                                              | Admin access                                                                              | Authoritative write path           |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| General support      | Opener only; unrelated users receive 404                                           | None                                                                                                | DB-reloaded admin with `manage_support` or `manage_transactions`, through `/admin/*` only | Support service/tables             |
| Reservation dispute  | Opener/customer and the other reservation participant; unrelated users receive 404 | Derived from the authoritative reservation participants; not independently revocable                | Same DB-backed admin gate; generic settlement is refused                                  | Reservation dispute service/tables |
| Need/job dispute     | Opener plus the engagement counterparty only while `counterparty_access=true`      | Auto-granted from an activated need or accepted job application; admin grant/revoke route is atomic | Same DB-backed admin gate                                                                 | Native case tables                 |
| Direct-payment issue | Opener plus the activated engagement counterparty only while granted               | Auto-granted only after an MHC activation proves the relationship; admin grant/revoke is atomic     | Same DB-backed admin gate                                                                 | Native case tables                 |
| Safety report        | Opener only; reported user receives 404 and no notification                        | Forbidden by `chk_resolution_cases_safety_is_private`                                               | Same DB-backed admin gate                                                                 | Native case tables                 |

The common user predicate is in
`HelpResolutionRepository.listCasesForUser()` and
`HelpResolutionService.loadForViewer()`: opener, or matching counterparty with
an explicit true grant. Search, filters and pagination are applied inside that
predicate and cannot widen it. `counterparty_id` alone grants nothing.

Admin routes execute `authenticate -> requireEmailVerified -> loadAdminFromDb ->
requireRole('admin') -> requireAdminAnyPermission(...)`. A stale JWT admin claim
is therefore insufficient. Assignment now verifies that the target is also an
active DB-backed admin with a case permission, rather than merely an existing
user.

The native counterparty lifecycle is exposed as
`PATCH /api/help-resolution/admin/cases/:caseId/counterparty-access` with
`{ granted: boolean }`. It is refused for support, reservation and safety cases.
Revocation removes list, detail and private-upload API access on the next request.

## Evidence-security verdict

The case, not caller-supplied ownership metadata, decides evidence access:

- Attach calls resolve the caller from the case and verify the private upload
  belongs to that user.
- `privateUploadIsAttachableEvidence()` additionally rejects any private upload
  already referenced by identity or academic verification records. This closes
  the reviewed path where a user could attach their own KYC image to a case and
  thereby expose it to a support admin or counterparty.
- Both native evidence and the legacy reservation evidence route use the same
  sensitive-upload exclusion.
- API case files return only `/api/upload/private/:uploadId`; bucket and object
  paths are not serialized.
- `GET /api/upload/private/:id` authenticates and authorizes every API request
  against current case/participant/grant state.
- A support admin without the verification/transaction blanket permissions can
  read only files actually linked as case evidence.
- Removing an evidence link immediately removes API-mediated case access; case
  deletion cascades evidence links.
- `(case_id, upload_id)` is unique, so racing attaches create one link.

Residual limitation: Supabase returns a bearer signed URL valid for 900 seconds.
Revocation prevents minting or resolving a new URL immediately, but cannot revoke
an already issued storage URL before its intended expiry. This is accepted for
this release; a future strict-immediate-revocation design should stream storage
objects through the API or use a materially shorter single-use capability.

## Message, timeline and status integrity

- Native message insert, timeline event and status/activity update share a
  transaction under a locked case row.
- Native evidence insert, activity update and timeline event now share a
  transaction under the same lock.
- Legacy support ticket creation and its opening message are atomic.
- Legacy support reply plus status transition are atomic.
- Unified support resolution reply, final status and unified outcome/note are
  atomic; a failed final status leaves no resolution reply behind.
- Internal native admin messages are excluded from both participant messages and
  participant timelines. Reservation-dispute note visibility remains governed
  by its existing `public`/`admin` semantics. General support refuses internal
  notes because its legacy message model cannot hide them.
- Ten concurrent native messages persisted all ten without lost updates.

No message idempotency key is currently part of the API contract. The web client
does not automatically retry POSTs and disables the submit action while pending,
but a caller deliberately repeating a successful request can create a second
message/event/notification. Add idempotency keys if retry-safe message creation
becomes a product requirement.

## Notifications and links

The five unified notification types carry only `caseId`, `referenceCode` and
`kind`, use generic non-sensitive text, and deep-link to the locale-aware
`/app/help-resolution?caseId=...` route. The reported user on a safety case is
never a recipient. English and Arabic templates contain the reference-code
placeholder. Legacy support and reservation-dispute links continue to resolve
server-side even when the target is not in the current page.

Notification delivery runs after the case transaction and catches delivery
failure, so it cannot corrupt case state. There is no automatic transaction
retry in these services, so a database retry cannot double-send. A repeated
client POST remains a separate action as noted above.

## Migration verdict

Verdict: safe to apply after normal production backup and preflight, but not
applied during this review.

- Production boundary: 102 applied, one pending (`20260801090000`).
- Dry-run against current production data: passed and rolled back.
- Blocking wallet/transaction/hold invariants: passed.
- Advisory existing-data warning: 59 historical completed transactions lack
  `balance_delta`; Wave 2I does not modify them.
- Clean replay: live-boundary columns 1283 MATCH; constraints 519 MATCH; indexes
  374 MATCH; all 103 repository migrations replayed.
- Rollback is documented in reverse dependency order and is idempotent.
- A real PostgreSQL apply/rollback/apply-boundary fingerprint test proves exact
  previous-schema restoration and no collateral object removal.
- Historical support/dispute backfills, migration rerun, one-spine-row
  uniqueness and trigger synchronization pass against PostgreSQL.
- Scratch cleanup verification found zero `mhc_replay_*` or `mhc_it_*`
  databases.

## Frontend integration verdict

- Antigravity's master/detail layout, metrics cards, category/status badges,
  modal presentation, mobile navigation, RTL rules and accessibility styling
  are preserved.
- The rendered centre uses `helpResolutionApiClient`; the legacy clients remain
  tested only for backward route compatibility, not browser-side aggregation.
- `/app/support` and `/app/disputes` render filtered unified views and historical
  query links resolve through authorized server lookups.
- Creation availability is server-driven; reservation disputes remain created
  from bookings.
- Evidence opens only through the authenticated private-upload API.
- The browser requests evidence from the same-origin
  `/api/proxy/private-upload` route with authorization. The proxy consumes the
  upstream redirect/body server-side and the client opens only a temporary
  `blob:` URL. No storage bucket, object path or raw signed storage URL is
  serialized to or opened by the help-resolution component.
- Engine-specific support and reservation status is displayed alongside unified
  status; resolution outcome and notes are visible rather than flattened away.
- Loading, error, empty and mobile master/detail states are covered.
- The locale layout sets `dir=rtl` for Arabic and `dir=ltr` for English. The case
  stylesheet uses logical alignment and no left/right layout assumptions.
- The `max-width: 768px` master/detail rules cover a 375px viewport. Grid items,
  links, filenames, titles, references and header chips have bounded widths and
  safe wrapping; the modal is capped to the viewport.
- The stale support-only CSS dependency was replaced by shared
  `case-thread.css`, used by both legacy support and the unified centre.
- Focus styling is scoped under `.support-screen`, avoiding unrelated dashboard
  pages. The new-case dialog traps forward/reverse Tab navigation, closes on
  Escape, and restores focus to the opening control.
- English/Arabic dictionaries, notification templates and navigation labels
  validate, and the production Next build emits all three help routes.

This review did not use a production authenticated fixture or mutate a real
account. The desktop browser controller could not initialize in this session,
so RTL/mobile verification is from the locale wrapper, focused CSS/component
contract tests and production build rather than a browser screenshot.

### Visual-polish contract matrix

| Requirement                                                     | Result                 | Proof                                                                                                                                                                                        |
| --------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence uses the authorized proxy                              | Pass                   | `handleOpenEvidence()` calls `getPrivateFileOpenableUrl()`; the helper fetches `/api/proxy/private-upload`, which forwards auth and returns bytes as a browser blob.                         |
| No bucket, object path or raw storage URL reaches the component | Pass                   | Case DTO tests expose only `/api/upload/private/:id`; the proxy consumes the upstream response server-side.                                                                                  |
| Canonical backend statuses only                                 | Pass                   | Unified `status` and authoritative `engineStatus` are mapped by `statusLabel()`/`statusPillInfo()`; no frontend-derived lifecycle status is invented.                                        |
| Safety reports never show a counterparty                        | Pass                   | The database constraint forbids one, the API omits one, and list/detail rendering additionally checks `kind !== 'safety_report'`.                                                            |
| Unsupported creation is disabled honestly                       | Pass                   | Availability and eligible subjects come from `GET /api/help-resolution/availability`; unavailable messages use its reason code.                                                              |
| Reservation disputes use the settlement flow                    | Pass                   | Creation routes to locale-aware `/app/bookings`; the generic API resolver still refuses this kind.                                                                                           |
| Historical support/dispute links retain context                 | Pass                   | `/app/support` and `/app/disputes` keep their default filters; `ticketId` and `disputeId` resolve through authorized server endpoints.                                                       |
| Mobile selection is retained                                    | Pass                   | `selectedCaseId` drives `support-layout--thread`; the viewport rule hides only the inactive pane and the back action clears selection explicitly.                                            |
| Dialog keyboard behavior is real                                | Pass                   | Focusable elements are queried at runtime; Tab/Shift+Tab wrap, Escape closes, and cleanup restores prior/opener focus.                                                                       |
| Arabic RTL and 375px bounds                                     | Pass by contract/build | Locale root supplies `dir`; logical properties mirror navigation; `min-width: 0`, `max-width: 100%`, wrapping and 375px rules prevent component-level overflow. No screenshot was available. |
| Long values wrap safely                                         | Pass                   | Titles, message bodies, metadata, header chips and evidence links use `overflow-wrap: anywhere` and bounded widths.                                                                          |
| Shared CSS/dictionaries avoid unrelated regressions             | Pass                   | Focus selector is screen-scoped; full lint, i18n, 292 web tests and production web build pass.                                                                                               |

## Focused corrections made during integration

1. Block identity/academic uploads from both native and reservation evidence.
2. Make native evidence plus timeline/activity atomic.
3. Hide internal-note timeline events from participants.
4. Require an authorized admin as an assignment target.
5. Add atomic native counterparty grant/revoke lifecycle and tests.
6. Make support creation, reply and unified resolution transactional.
7. Preserve support resolution outcome/notes and clear them on reopen.
8. Add documented, fingerprint-tested migration rollback.
9. Preserve authoritative engine statuses/outcomes in the UI.
10. Replace the stale CSS dependency and correct pre-backend frontend tests.
11. Merge the visual polish without weakening canonical engine status/outcome
    display or server-driven availability.
12. Add a real focus trap, Escape behavior and focus restoration to the polished
    dialog.
13. Suppress safety counterparties defensively and bound long/mobile content.
14. Scope the polish focus selector to the help-resolution screen.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run validate:i18n`: passed.
- `npm run test`: shared 17 passed; API 522 passed with opt-in PG suites skipped;
  web 292 passed.
- `npm run build -w @mohandishub/api`: passed.
- `npm run build -w @mohandishub/web`: passed.
- Real PostgreSQL/HTTP Wave 2I suite: 44 passed, serial, no file parallelism.
- `node scripts/migration-dryrun.mjs`: passed and rolled back.
- `node scripts/migration-replay-check.mjs`: passed; exact live-boundary match;
  zero scratch databases remained.

## Remaining risks and recommendation

No merge blocker remains in the reviewed Wave 2I scope.

Non-blocking follow-ups:

1. Decide whether the current broad case-admin policy (`manage_support` OR
   `manage_transactions` for every case kind) should later be split by case
   type. It is DB-backed and intentional in the current contract, but the
   permission taxonomy is coarse.
2. Add message idempotency keys if automatic/retry-safe POST semantics are
   introduced.
3. Replace 15-minute direct storage URLs if revocation must invalidate already
   minted capabilities instantly.
4. Case-state audit rows are written after the service transaction under the
   repository's existing audit pattern. If audit/state atomicity becomes a
   compliance requirement, introduce a transactional audit/outbox abstraction
   rather than patching individual controllers.

Recommendation: merge `integration/wave-2i-final` by fast-forward or reviewed
PR after the final branch tip is confirmed. Before deployment, take a production
backup, rerun the dry-run, apply and track migration `20260801090000` atomically,
then deploy API before or together with web. Do not deploy the web against an API
where the migration/routes are absent.
