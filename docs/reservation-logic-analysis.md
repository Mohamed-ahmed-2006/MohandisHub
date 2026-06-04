# Reservation Logic: Customer & Expert Flows — Analysis & Flaws

## Overview

The app has **two** booking-related systems:

1. **Reservations** — Request → Provider accepts/rejects → Hold/capture/refund. Used for **service bookings** (home → Book a service) and **job interviews** (expert books slot with business).
2. **Legacy bookings** — Removed from the launch API/client surface. Historical `bookings` table migrations may remain, but `/api/bookings` is not mounted and the old immediate-payment module/client code has been removed.

This document focuses on **Reservations** as used from the app (customer + expert/provider).

---

## Customer flow (what happens)

1. **Create request**
   - Customer opens a service (e.g. from home search) → **Service booking modal** (`service-booking-modal.tsx`).
   - Chooses **mode** (online voice/video or offline), **slot** from provider’s available slots.
   - Submits → `reservationsApiClient.createReservation()` → `POST /api/reservations` (role `customer` required).
   - **Backend:** Creates reservation row with `status: 'pending'`. **No wallet hold at this point.** If provider has `auto_accept`, service immediately runs `decideReservationInternal(..., accept)` and slot is marked `booked`, hold + acceptance fee charged.

2. **See requests**
   - Customer goes to **Bookings** (`/app/bookings`) → **BookingsScreen** loads `listMyReservations(accessToken, { role: 'customer', ... })` and shows list (pending, accepted, completed, etc.).

3. **After provider accepts**
   - Reservation moves to `accepted` (and optionally `awaiting_start` → `in_session` → `waiting_customer_done` → `completed`).
   - **Money:** On **accept**, backend:
     - Marks slot `booked`,
     - Runs `ensureFixedPriceHold` (creates wallet hold for `expert_price_amount` from customer),
     - Runs `chargeAcceptanceFee` (debits customer for `admin_acceptance_fee`),
     - Sets `settlement_status: 'held'` when price > 0.
   - Customer can cancel (policy-dependent), do offline check-in, join online call, or mark “done” / report.

4. **Cancel**
   - Customer can cancel from detail view; cancellation outcome (refund vs release to provider) depends on policy snapshot and who cancels.

---

## Expert / Provider flow (what happens)

1. **Slots**
   - Expert/business sets **reservation profile** (prices, auto-accept) and **slots** on **Calendar** (`/app/calendar`) — `createSlot`, `updateSlot`, `deleteSlot`. Slots are `available` until a reservation is accepted for that slot.

2. **Incoming requests**
   - When a customer creates a reservation (no auto-accept), it stays `pending`.
   - Provider sees it on **Bookings** (`/app/bookings`): **BookingsScreen** for expert fetches **both** `role: 'provider'` and `role: 'customer'` and merges (so expert sees requests where they are provider and where they are customer, e.g. job interviews).

3. **Accept / Reject**
   - Provider opens a pending reservation and clicks **Accept** or **Reject**.
   - **Accept** → `POST /api/reservations/:id/decision` with `{ decision: 'accept' }`:
     - Backend checks slot still `available`, then:
       - Sets slot to `booked`,
       - Creates **fixed-price hold** on customer wallet (can fail with `INSUFFICIENT_BALANCE`),
       - Charges **acceptance fee** (can also fail),
       - Sets status to `accepted`, creates conversation, sends chat message.
     - If hold or fee fails, the whole transaction is rolled back; reservation stays `pending`.
   - **Reject** → status set to `rejected`, optional reason and `suggestedSlots` if rejection was due to slot conflict.

4. **After accept**
   - Provider can propose/respond to location (offline), manage check-in, run online call, or finish. Settlement (release to provider or refund) happens on complete/cancel paths.

---

## Logical flaws and gaps

### 1. **Hold on accept, not on create**
- **Issue:** Customer is not charged or held when they submit the request. The hold (and acceptance fee) are applied only when the **provider** accepts. If the customer has insufficient balance at that moment, **accept fails** (DB rollback), reservation stays `pending`, and the provider sees a generic error (e.g. “Action failed”).
- **Impact:** Provider thinks they accepted; customer may not know they need to top up. No in-app signal that “this request cannot be accepted until the customer adds funds.”
- **Recommendation:** Either hold (or soft-reserve) the required amount at **create** time, or clearly surface “insufficient balance” to the provider and notify the customer to add funds before the provider can accept.

### 2. **Same slot, multiple pending requests**
- **Issue:** Several customers can create **pending** reservations for the **same** slot (slot is only marked `booked` on accept). When the provider accepts the first, the slot becomes `booked`. A second provider accept for the same slot fails with “slot no longer available” and the reservation is **auto-rejected** with `suggestedSlots`.
- **Impact:** The second (and later) customers are left with a **pending** reservation that will never be accepted. They are not automatically notified that the slot was taken; they only see rejection (and possibly suggestions) if the provider explicitly rejects or if they refresh and see status change. No automatic “slot taken” notification or expiry of obsolete pending requests.
- **Recommendation:** When a slot is accepted for one reservation, consider auto-rejecting (with a clear reason) other pending reservations for that slot and notifying those customers. Optionally expire or warn on stale pending requests.

### 3. **Expert calendar vs bookings**
- **Issue:** **Calendar** screen loads “my” slots and “my” reservations with `role: 'provider'` only. It does not show **pending** reservations that might be waiting for the expert’s decision; it’s focused on slot management and calendar view. So the expert’s main place to **accept/reject** is **Bookings**, not Calendar. That’s consistent but not obvious; some experts might expect to see “pending request” on the calendar slot.
- **Impact:** Minor UX: experts must go to Bookings to decide; no in-calendar “pending request” indicator.
- **Recommendation:** Optionally show pending reservation count or list on Calendar (e.g. “You have N pending requests”) and/or link to Bookings for decisions.

### 4. **Bookings vs reservations terminology**
- **Issue:** The **Bookings** page and route (`/app/bookings`) show reservations (pending/accepted/completed). The legacy immediate-payment bookings API/client has been removed for launch.
- **Impact:** Lower money-flow risk: users have one booking flow with request, hold, completion, cancellation, and dispute states.
- **Recommendation:** If the product keeps the “Bookings” label, treat it as the user-facing name for reservations. Do not reintroduce an instant-payment booking flow without a separate payment/security review.

### 5. **Rejection reason and suggested slots**
- **Issue:** When the provider **rejects** from the UI, the code sends a fixed reason: `rejectionReason: 'Rejected by provider'`. So the customer always sees that text; the provider cannot type a custom reason. When rejection is due to **slot conflict**, the backend fills `suggestedSlots` and a generic message; the UI shows both, which is good, but the provider cannot add a short note.
- **Impact:** Limited feedback for the customer; no way to say “next week works better” in the reject flow.
- **Recommendation:** Add an optional “rejection reason” field in the decide modal and send it in `decideReservation`.

### 6. **Idempotency on create**
- **Issue:** The frontend sends a new `Idempotency-Key` (UUID) on every **create** call. So each click is a new key; duplicate submissions (e.g. double-click) are not idempotent and can create multiple pending reservations for the same slot.
- **Impact:** Double-click or slow UI can create duplicate “pending” requests for the same customer/slot.
- **Recommendation:** Derive idempotency key from something stable per “intent” (e.g. customerId + slotId + a short time window, or a key stored in component state for that modal session) so duplicate submits are deduplicated.

### 7. **Business role and bookings**
- **Issue:** **BookingsScreen** for **business** uses `role: 'provider'` only (no merge with `customer`). So a business sees only reservations where they are the provider. For **job interviews**, the **expert** is the “customer” and the **business** is the provider; the business correctly sees those on Bookings as provider. Experts see both provider and customer (their interviews). So business flow is consistent but different from expert (no “as customer” list).
- **Impact:** None if job interviews are the only case where a business is provider; just worth being aware.

### 8. **Pending reservation expiry**
- **Issue:** There is no automatic expiry of **pending** reservations (e.g. “pending for 7 days”). So if the provider never accepts or rejects, the request stays pending and the slot remains “available” in listSlots (availableOnly=true) until another reservation is accepted for that slot or the slot is updated/deleted.
- **Impact:** Stale pending requests can pile up; customers may assume the request is still valid; slot can be shown as available and get a second request.
- **Recommendation:** Add a lifecycle job or rule that expires reservations that have been `pending` for more than X days (or hours), and optionally release the slot or notify both sides.

### 9. **Finish reservation “report” path**
- **Issue:** Customer can **finish** with `action: 'report'` (e.g. “Report” instead of “Done”). Backend creates a **dispute** and the reservation can move to `disputed`. Dispute resolution is admin-only (`resolveDispute`). So the flow exists but the customer may not have a clear “my dispute was resolved” state in the UI.
- **Impact:** Depends on how prominently disputes and resolution are shown in the Bookings detail view.

### 10. **Two systems: Reservations vs Bookings**
- **Status:** Resolved for launch. The old immediate-payment bookings API/client/shared types were removed from the launch code path. The active booking product uses reservations only.

---

## Summary table

| # | Flaw / gap | Severity | Where |
|---|------------|----------|--------|
| 1 | Hold on accept → accept can fail if customer balance low; no clear UX for “top up to allow accept” | High | `decideReservationInternal` + BookingsScreen |
| 2 | Multiple pending for same slot; only first accept wins; others left pending without clear “slot taken” handling | High | createReservation + decideReservation |
| 3 | Pending requests not visible on Calendar; expert must use Bookings | Low | CalendarScreen |
| 4 | “Bookings” page shows reservations, not the other booking type | Low | Naming / docs |
| 5 | No custom rejection reason from provider | Medium | BookingsScreen decide call |
| 6 | Duplicate create possible (new idempotency key per click) | Medium | service-booking-modal + createReservation |
| 7 | Business only sees provider side (OK for job interviews) | Info | BookingsScreen |
| 8 | No auto-expiry of long-pending reservations | Medium | Reservations lifecycle |
| 9 | Dispute resolution UX for customer | Low | BookingsScreen detail |
| 10 | Legacy immediate-payment bookings removed from launch code path | Resolved | App-wide |

---

## Files reference

- **Customer:** `apps/web/components/app/service-booking-modal.tsx` (create), `apps/web/components/app/bookings-screen.tsx` (list, cancel, finish, location, call).
- **Provider:** Same `bookings-screen.tsx` with `role: 'provider'` (and for expert, merged with `role: 'customer'`); accept/reject via `decideReservation`. Calendar: `apps/web/components/app/calendar-screen.tsx` (slots + profile).
- **API:** `apps/api/src/modules/reservations/` (create, list, decide, cancel, finish, call, etc.). Legacy immediate-payment bookings module/client code has been removed from the launch surface.
