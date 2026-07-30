# Wave 2G & Wave 2H Team Management & Invitations API Contract & UI Specification

## Overview
This document specifies the frontend implementation, role permission model, invitation lifecycle state machine, and required backend API contracts for:
- **Wave 2G**: Business-Team Permissions and Management UI
- **Wave 2H**: Team Invitations

Branch: `feat/wave-2gh-team-invitations-ui`  
Authoritative Baseline: `origin/main` (`1aa7978`)

---

## 1. Product & Permission Model

Business workspace membership is decoupled from the user's primary account role (`user.role`). A user may hold a primary account role of `business` (or `expert`/`customer`/`craftsman`) while operating within a business workspace with specific workspace-scoped roles.

### Business Workspace Roles & Intended Permissions

| Workspace Role | Key | Scope / Intended Capabilities |
| :--- | :--- | :--- |
| **Owner** | `owner` | Full business access, team administration, billing/financials, ownership transfer, member removal, business settings. |
| **Admin** | `manager` / `admin` | Team operations, catalogue/services management, hiring/jobs, analytics, operational management. *No ownership transfer or billing operations unless backend policy explicitly permits.* |
| **Member** | `member` | Assigned operational access (e.g. view analytics, manage assigned jobs/reservations). *No billing, no ownership transfer, no unrestricted team administration.* |
| **Viewer** | `viewer` | Read-only analytics and operational visibility. |

> **Security Rule**: The backend remains authoritative. All frontend checks control action visibility and UX hint text; frontend checks **never** substitute for server-side authorization enforcement.

---

## 2. Existing Endpoints (Authoritative Baseline)

| Method | Route | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/business-teams/me` | Fetches business team overview (team metadata, roles, members, invites) for current business user. | Bearer Token (Verified Business User) |
| `POST` | `/api/v1/business-teams/roles` | Creates a custom workspace role with specific permissions. | Bearer Token (Business Owner) |
| `PATCH` | `/api/v1/business-teams/roles/:roleId` | Updates custom workspace role permissions/name. | Bearer Token (Business Owner) |
| `DELETE` | `/api/v1/business-teams/roles/:roleId` | Deletes custom role with replacement role mapping. | Bearer Token (Business Owner) |
| `POST` | `/api/v1/business-teams/invites` | Sends team invite (`email`, `roleId`), saves SHA-256 token hash, triggers invite email. | Bearer Token (Business Owner/Admin) |
| `POST` | `/api/v1/business-teams/invites/:inviteId/revoke` | Revokes pending invitation. | Bearer Token (Business Owner/Admin) |
| `POST` | `/api/v1/business-teams/invites/accept` | Accepts invitation using `{ token }` payload; creates `business_members` record and marks invite accepted. | Bearer Token (Authenticated Recipient) |

---

## 3. Missing Backend Endpoints & Required Contracts

To complete full end-to-end team management functionality, the following endpoints are required from the backend team. The frontend keeps these actions safely disabled or displays an honest "Pending Deployment" notice.

### 3.1 Invitation Details / Preview Endpoint
- **Proposed Route**: `GET /api/v1/business-teams/invites/preview?token=:token`
- **Purpose**: Fetch invitation details before accepting so the UI can display inviter details, target team name, role, and current invitation state.
- **Request Parameters**: `token` (query string, string)
- **Expected Response (200 OK)**:
  ```json
  {
    "ok": true,
    "data": {
      "id": "uuid",
      "teamName": "Engineering Studio Ltd",
      "inviterDisplayName": "Alice Owner",
      "inviterEmail": "alice@studio.com",
      "recipientEmail": "bob@engineer.com",
      "roleName": "Member",
      "roleKey": "member",
      "status": "pending", // "pending" | "accepted" | "expired" | "revoked"
      "expiresAt": "2026-08-06T12:00:00.000Z",
      "isRecipientMatchingSignedUser": true
    }
  }
  ```
- **Error Codes**: `INVITE_NOT_FOUND` (404), `INVITE_EXPIRED` (410), `INVITE_REVOKED` (410), `INVITE_ALREADY_USED` (409).

### 3.2 Member Removal Endpoint
- **Proposed Route**: `DELETE /api/v1/business-teams/members/:memberId`
- **Purpose**: Allow business owner/admin to remove a member from the workspace team.
- **Request Headers**: `Authorization: Bearer <token>`
- **Expected Response (200 OK)**:
  ```json
  {
    "ok": true,
    "data": {
      "removedMemberId": "uuid",
      "teamId": "uuid"
    }
  }
  ```
- **Error Codes**: `CANNOT_REMOVE_OWNER` (400), `MEMBER_NOT_FOUND` (404), `FORBIDDEN` (403).

### 3.3 Member Role Update Endpoint
- **Proposed Route**: `PATCH /api/v1/business-teams/members/:memberId`
- **Purpose**: Update a member's assigned workspace role.
- **Request Body**:
  ```json
  {
    "roleId": "uuid"
  }
  ```
- **Expected Response (200 OK)**:
  ```json
  {
    "ok": true,
    "data": {
      "memberId": "uuid",
      "newRoleId": "uuid"
    }
  }
  ```

### 3.4 Ownership Transfer Endpoint
- **Proposed Route**: `POST /api/v1/business-teams/transfer-ownership`
- **Purpose**: Transfer primary ownership of the business workspace to another member.
- **Request Body**:
  ```json
  {
    "targetUserId": "uuid"
  }
  ```
- **Expected Response (200 OK)**:
  ```json
  {
    "ok": true,
    "data": {
      "previousOwnerId": "uuid",
      "newOwnerId": "uuid",
      "transferredAt": "2026-07-30T13:46:00.000Z"
    }
  }
  ```

---

## 4. Invitation Lifecycle & State Machine

```
[ Owner/Admin creates invite ]
           │
           ▼
     ┌───────────┐
     │  Pending  │
     └─────┬─────┘
           │
 ┌─────────┼───────────────────┬──────────────────┐
 │         │                   │                  │
 ▼         ▼                   ▼                  ▼
[Accept]  [Token Expiry]  [Owner Revokes]  [Wrong Account]
 │         │                   │                  │
 ▼         ▼                   ▼                  ▼
Accepted  Expired             Revoked        State Error:
                                            "Switch account"
```

### States & UI Guidance

1. **Pending**:
   - Acceptance page shows team name, role, inviter info, and an "Accept Invitation" CTA button.
   - Owner team panel shows invitation in "Pending Invitations" list with a "Revoke" button.
2. **Accepted / Already Used**:
   - Acceptance page displays "Invitation Already Accepted" with a direct button to "Open Business Workspace".
3. **Expired**:
   - Acceptance page displays "Invitation Expired" notice recommending contacting the business admin for a new invite.
4. **Revoked**:
   - Acceptance page displays "Invitation Revoked" notice.
5. **Wrong Signed-In Account (Identity Binding)**:
   - When the signed-in user's email does not match `recipientEmail`, UI prompts user to sign out and log into the matching account (`recipientEmail`).

---

## 5. Routes & Frontend Implementation Completed

- **Team Management Panel**: Integrated into `/app` Business Dashboard under the "Team" tab (`apps/web/components/app/business-team-panel.tsx`).
- **Invitation Acceptance Page**: Accessible at `/invitations/accept?token=...` or `/:locale/invitations/accept?token=...` (`apps/web/app/[locale]/invitations/accept/page.tsx`).
- **Web API Client**: Added `acceptInvite` to `businessTeamsApiClient` in `apps/web/lib/business-teams/client.ts`.
- **CSS & Mobile Layout**: Responsive cards and table wrappers supporting viewports down to 375px in `apps/web/app/dashboard.css`.

---

## 6. Security Assumptions & Scope Boundaries

- **Database / Schema**: No database migrations or schema modifications were made.
- **Backend Middleware**: No changes made to authentication or authorization middleware.
- **Token Security**: Token hashing (`SHA-256`) and verification remain strictly managed by the backend.
- **Financial / MHC / Ads**: Zero changes to MHC charging, billing infrastructure, advertisement engine, or subscription plans.
