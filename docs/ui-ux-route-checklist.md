# UI/UX Route Checklist

Use this checklist to validate the redesign route-by-route while confirming functionality parity.

## Core Shell

- `app-shell` desktop: sidebar width, sticky topbar, avatar/notifications alignment, no clipped controls.
- `app-shell` mobile: hamburger opens/closes sidebar reliably, backdrop closes drawer, no horizontal scroll.
- Theme switch check: light/dark contrast remains readable for cards, buttons, badges, and glass panels.

## Auth Flow

- `/auth` login: form hierarchy is clear, spacing is compact, focus states visible, errors readable.
- `/auth` register role step: role cards render consistently and tap targets are comfortable on mobile.
- `/verify-email` and reset flows: banners and CTA states keep visual hierarchy and do not overflow.

## Dashboard Routes

- `/app` home: search card density improved, filters align on tablet/mobile, no large dead whitespace.
- `/app/bookings`, `/app/services`, `/app/history`, `/app/chat`: cards and list/table rows keep consistent paddings.
- `/app/profile`, `/app/settings`, `/app/settings/wallet`: section blocks use uniform glass surface treatment.
- `/app/admin`: tabs remain usable on small screens and data tables stay scrollable without breaking layout.

## Modals And Drawers

- Support modal, profile modal, wallet deposit modal, service booking drawer, image preview modal:
  - close on backdrop and escape where applicable
  - proper z-index stacking over shell
  - no clipped header/footer actions
  - smooth enter/exit animations
- Confirm same behavior as before for submit/close/cancel actions (no logic regressions).

## Media Library And Announcements

- Admin media tab:
  - upload image + metadata
  - toggle active/inactive
  - delete asset
  - filter by usage type
- Global announcement banner:
  - shows text-only when no image exists
  - shows image + text when active announcement media exists
  - responsive and non-blocking on narrow screens

## Upload UX Consistency

- `ImageUploadOrCapture` shows accepted formats and clear hints.
- Preview + validation messaging is consistent across support/profile/onboarding/admin flows.
- Existing upload constraints still enforced by backend (size/mime/access rules unchanged).

## Functional Parity Smoke Tests

- Auth/login/logout/session refresh.
- Customer/expert/business dashboard actions still submit the same way.
- Booking creation and online call modal open/close behavior.
- Support ticket creation with and without image attachments.
- Wallet deposit flows (card/crypto/instapay) still execute same backend paths.
- Admin permissions unchanged across tabs and actions.
