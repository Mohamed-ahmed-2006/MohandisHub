# Reservation V2 Money Abuse Map

## Scope

- Customer and provider abuse attempts around reservation funds, minute billing, holds, and payout release.

## 1) Slot overlap double-booking

- Exploit path: provider creates overlapping active slots and drives two reservations into acceptance for the same time.
- Control: DB exclusion constraint `reservation_slots_no_overlap_active` blocks overlap for `available/booked` states; conflicts return `409 SLOT_OVERLAP`.
- Residual risk: legacy overlap data before migration is converted to `blocked` (best-effort), so admins should monitor blocked-slot volume after deploy.

## 2) Disconnect/rejoin billing evasion

- Exploit path: participant toggles connection to avoid minute charges while still consuming session time.
- Control: billing only accrues while both are connected and call session is active; disconnect pauses billing and sets deterministic timeout. Per-second billing with carry prevents free fractional-minute leakage.
- Residual risk: if client heartbeat is intentionally suppressed, timeout handling still settles server-side state, but near-real-time status may lag until sweep/next signal.

## 3) Stale timeout non-execution

- Exploit path: rely on endpoint-triggered checks never running so auto-release/prompt never executes.
- Control: lifecycle worker runs every 60 seconds with advisory lock and `FOR UPDATE SKIP LOCKED`, making timeout execution independent of read traffic.
- Residual risk: prolonged full API outage pauses sweeps until service recovery.

## 4) Race-based location decision overwrite

- Exploit path: simultaneous accept/reject on one location proposal to force inconsistent decision state.
- Control: atomic conditional update (`status = 'pending'`) ensures only one decision wins; loser receives `409 PROPOSAL_ALREADY_DECIDED`.
- Residual risk: none on the proposal row itself; business-level disagreement still possible and handled by additional proposals/dispute flow.

## 5) Token-expiry interruption abuse

- Exploit path: token expiry intentionally forced/left unresolved to break session and manipulate settlement timing.
- Control: explicit token renew endpoint reissues token for same reservation channel and participant UID; frontend renews on Agora expiry callbacks with retry and controlled disconnect fallback.
- Residual risk: repeated network/API failure can still drop calls; settlement remains deterministic by server lifecycle rules.

## 6) Payout/hold release sequencing abuse

- Exploit path: trigger duplicate completion paths (manual end, timeout, retries) to release payout more than once or refund after capture.
- Control: hold status transitions (`held -> captured/released`) are idempotent, reservation status transitions are transaction-guarded, and timeout processing uses row locks to avoid duplicate workers.
- Residual risk: operational misconfiguration (manual DB edits) can still break invariants; monitor wallet/hold reconciliation reports.
