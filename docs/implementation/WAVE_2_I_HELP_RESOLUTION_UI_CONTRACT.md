# Wave 2I Unified Help & Resolution Center API Contract & Specification

## Overview

This document specifies the unified frontend presentation, route consolidation, evidence security model, case lifecycle state machine, and required backend API contracts for:

- **Wave 2I**: Unified Help & Resolution Center

Branch: `feat/wave-2i-help-resolution-ui`  
Authoritative Baseline: `origin/main` (`1aa7978`)

---

## 1. Product Objective & Conceptual Model

The **Help & Resolution Center** unifies platform support ticketing and marketplace dispute resolution into a single cohesive experience (`/app/help-resolution`).

### Unified Case Categories

| Unified Category Key  | Display Name (EN)    | Display Name (AR)       | Underlying Engine / Endpoint                                |
| :-------------------- | :------------------- | :---------------------- | :---------------------------------------------------------- |
| `general_support`     | General Support      | الدعم الفني العام       | Support Ticket API (`/api/v1/support/tickets`)              |
| `need_job_dispute`    | Need / Job Dispute   | نزاع طلب / وظيفة        | Documented Contract (Missing standalone API)                |
| `reservation_dispute` | Reservation Dispute  | نزاع حجز                | Reservation Dispute API (`/api/v1/reservations/disputes/*`) |
| `direct_payment`      | Direct Payment Issue | مشكلة دفع مباشر / تسوية | Documented Contract (Missing standalone API)                |
| `safety_reporting`    | Safety & Reporting   | بلاغ سلامة / انتهاك     | Documented Contract (Support Ticket fallback)               |

---

## 2. Existing Endpoints (Baseline Inventory)

### 2.1 Support Ticket Endpoints

| Method | Route                                        | Purpose                                                                          | Auth Required |
| :----- | :------------------------------------------- | :------------------------------------------------------------------------------- | :------------ |
| `POST` | `/api/v1/support/tickets`                    | Create general support ticket (`category`, `subject`, `body`, `attachmentUrls`). | Bearer Token  |
| `GET`  | `/api/v1/support/tickets`                    | List user's support tickets with status and message counts.                      | Bearer Token  |
| `GET`  | `/api/v1/support/tickets/:ticketId`          | Fetch ticket details.                                                            | Bearer Token  |
| `GET`  | `/api/v1/support/tickets/:ticketId/messages` | List thread messages for ticket.                                                 | Bearer Token  |
| `POST` | `/api/v1/support/tickets/:ticketId/messages` | Reply to ticket (`body`, `attachmentUrls`).                                      | Bearer Token  |

### 2.2 Reservation Dispute Endpoints

| Method | Route                                               | Purpose                                                                                           | Auth Required      |
| :----- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :----------------- |
| `GET`  | `/api/v1/reservations/dispute-cases/my`             | List user's active/historical reservation disputes.                                               | Bearer Token       |
| `GET`  | `/api/v1/reservations/disputes/:disputeId`          | Get full dispute case file (dispute, reservation, evidence, notes, money events, audit timeline). | Bearer Token       |
| `POST` | `/api/v1/reservations/disputes/:disputeId/notes`    | Add case note / message to dispute thread.                                                        | Bearer Token       |
| `POST` | `/api/v1/reservations/disputes/:disputeId/evidence` | Attach private upload evidence to dispute (`uploadId`, `label`).                                  | Bearer Token       |
| `GET`  | `/api/v1/reservations/admin/dispute-cases`          | Admin list dispute queue.                                                                         | Admin Bearer Token |
| `POST` | `/api/v1/reservations/disputes/:disputeId/resolve`  | Admin resolve dispute with refund/release decision.                                               | Admin Bearer Token |

---

## 3. Missing Backend Endpoints & Required Contracts

> **Status: delivered.** These endpoints now exist, though not all at the shape
> proposed below. The frontend no longer aggregates client-side and no creation
> flow is marked "Pending Deployment". See
> [`WAVE_2_I_HELP_RESOLUTION_BACKEND.md`](./WAVE_2_I_HELP_RESOLUTION_BACKEND.md)
> for the delivered routes and the reasons each proposal moved:
> the two dispute-creation endpoints collapsed into `POST /api/help-resolution/cases`
> discriminated on `kind`, reference codes are issued by the server rather than
> sliced from a uuid, and `unreadCount` was dropped because neither engine has a
> per-user read marker to compute it from.

The following endpoints were originally proposed.

### 3.1 Unified Case Listing Endpoint

- **Proposed Route**: `GET /api/v1/help-resolution/cases`
- **Purpose**: Unified paginated listing of support tickets and marketplace disputes for the authenticated user.
- **Query Parameters**: `category`, `status`, `page`, `limit`, `search`
- **Expected Response (200 OK)**:
  ```json
  {
    "ok": true,
    "data": {
      "items": [
        {
          "id": "case-uuid",
          "kind": "support_ticket", // "support_ticket" | "reservation_dispute" | "job_dispute"
          "referenceCode": "TKT-84920",
          "category": "general_support",
          "status": "open",
          "title": "Issue with profile verification",
          "counterpartyName": null,
          "createdAt": "2026-07-30T12:00:00.000Z",
          "updatedAt": "2026-07-30T14:00:00.000Z",
          "unreadCount": 1
        }
      ],
      "total": 1
    }
  }
  ```

### 3.2 Need/Job Dispute Creation Endpoint

- **Proposed Route**: `POST /api/v1/help-resolution/job-disputes`
- **Purpose**: Open a dispute for a customer need or expert job bid.
- **Request Body**:
  ```json
  {
    "jobId": "uuid",
    "reason": "non_delivery",
    "description": "Expert did not submit deliverables as agreed.",
    "evidenceUploadIds": ["upload-1", "upload-2"]
  }
  ```

### 3.3 Direct Payment / Settlement Dispute Endpoint

- **Proposed Route**: `POST /api/v1/help-resolution/payment-disputes`
- **Purpose**: Report direct-payment offline or settlement discrepancy.
- **Request Body**:
  ```json
  {
    "transactionRef": "TX-12345",
    "amount": 1500,
    "currency": "EGP",
    "description": "Payment was processed but escrow balance was not released."
  }
  ```

---

## 4. Evidence Security Model

```
 ┌──────────────────────────────────────────────────────────┐
 │                  Evidence File Security                  │
 ├──────────────────────────────┬───────────────────────────┤
 │ Platform Support Attachments │ Private Dispute Evidence  │
 ├──────────────────────────────┼───────────────────────────┤
 │ - Stored as public paths     │ - Uploaded via private    │
 │ - Max 2 attachments/msg      │   proxy upload            │
 │ - Rendered directly via      │ - Stored with uploadId    │
 │   `/uploads/...` static path │ - Openable via secure     │
 │                              │   signed temporal URLs    │
 └──────────────────────────────┴───────────────────────────┘
```

- **Security Rule**: Insecure public attachment URLs are **never** invented for private dispute evidence files. Private dispute evidence uses `getPrivateFileOpenableUrl` to generate short-lived, authenticated openable URLs.

---

## 5. Route Consolidation & Backward Compatibility

- **Primary Unified Route**: `/app/help-resolution` (`apps/web/app/[locale]/app/help-resolution/page.tsx`)
- **Legacy Route Redirection**:
  - `/app/support` — Renders `HelpResolutionScreen` initialized to `General Support` filter tab, preserving existing bookmarks.
  - `/app/disputes` — Renders `HelpResolutionScreen` initialized to `Marketplace Disputes` filter tab, preserving historical case views.
- **Deep Links**:
  - `/app/help-resolution?caseId=:id`
  - `/app/help-resolution?disputeId=:id`
  - `/app/help-resolution?ticketId=:id`
  - All existing deep links automatically open the target case detail view.

---

## 6. Role & Authorization Assumptions

- **Authoritative Backend**: Client-side filtering and role visibility are presentational only. All case viewing, message posting, evidence attachment, and admin resolution calls are authenticated and authorized on the backend.
- **No Client Identifiers Invention**: Counterparty identities and permissions are displayed **only** when returned in official API payloads.

---

## 7. Scope Boundaries & Shared Files Changed

- **Database / Schema**: Zero database migrations or schema alterations.
- **Financial / MHC / Ads**: Zero changes to financial, MHC, charging, plans, or advertisement infrastructure.
- **Business Teams**: Zero changes to `feat/wave-2gh-team-invitations-ui` code.
