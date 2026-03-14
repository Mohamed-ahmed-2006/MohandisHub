# Escrow and dispute flow

## Fund release rules

- **Reservations:** Customer funds are held (wallet hold) when a reservation is accepted. Funds release to the provider when the reservation is completed (status `completed`) and settlement is `released_to_provider`, or refund to the customer when cancelled/refunded per policy.
- **Milestone-based (jobs):** Business holds; release per milestone approval (provider submits, business approves) or on job completion.
- **Disputes:** When a user opens a dispute (e.g. via support ticket or reservation dispute), admin can reconcile: refund customer, release to provider, or split. Use Admin reservation reconcile and support ticket flow.

## Implementation status

- Reservation lifecycle and settlement status are implemented in `reservations` module (`settlement_status`, `refund_status`, release on completion).
- Disputes: use Support tickets for “dispute” type or reservation-specific dispute endpoints where available; admin can adjust via wallet/reconcile as needed.
- This doc serves as the single place for release rules and dispute handling policy.
