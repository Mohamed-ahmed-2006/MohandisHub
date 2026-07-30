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

> **Audit Note on Built-in Roles**: While the backend seed schema defines an auxiliary `viewer` role key, the approved built-in workspace roles in the product model are strictly **Owner**, **Admin**, and **Member**. Custom roles created by workspace owners are displayed by their assigned name (`roleName`), but their workspace security classification falls under Owner, Admin, or Member.

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
| `POST` | `/api/v1/business-teams/invites/accept` | Accepts invitation using `{ token }` payload; creates `business_members` record with `role_id` and marks invite accepted. | Bearer Token (Authenticated Recipient) |

---

## 3. Missing Backend Endpoints & Required Contracts

To complete full end-to-end team management functionality, the following endpoints are required from the backend team. The frontend keeps these actions safely disabled or displays an honest "Pending Deployment" notice.

### 3.1 Invitation Details / Preview Endpoint
- **Proposed Route**: `GET /api/v1/business-teams/invites/preview?token=:token`
- **Purpose**: Fetch invitation details before accepting so the UI can display inviter details, target team name, assigned role, and pre-acceptance invitation status.
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
      "roleName": "Senior Engineer",
      "roleKey": "custom_1700000000",
      "status": "pending",
      "expiresAt": "2026-08-06T12:00:00.000Z",
      "isRecipientMatchingSignedUser": true
    }
  }
  ```
- **Pre-Acceptance UI Rule**: Because this GET preview endpoint is currently missing on the backend, the pre-acceptance screen (`/invitations/accept?token=...`) makes **no unverified claims** about team name, inviter name, assigned role, or token validity prior to submission. Specific error states (`expired`, `revoked`, `already_used`) are rendered strictly after the backend accept endpoint responds.

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

### 3.3 Member Role Update Endpoint
- **Proposed Route**: `PATCH /api/v1/business-teams/members/:memberId`
- **Purpose**: Update a member's assigned workspace role.
- **Request Body**:
  ```json
  {
    "roleId": "uuid"
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

---

## 4. Invitation Role Preservation Audit

Analysis of backend implementation (`POST /api/v1/business-teams/invites/accept`):

```sql
INSERT INTO business_members (team_id, user_id, role, role_id)
VALUES ($1, $2, 'member', $3)
ON CONFLICT (team_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id
```

- **Findings**: The backend correctly saves `role_id = invite.role_id` in `business_members`, preserving the specific role (custom or built-in) selected by the inviter. While the legacy string column `role` is set to `'member'`, client queries (`getOverview`) join `business_members.role_id` to `business_team_roles.id`, thereby exposing the accurate `role_name`, `role_key`, and permission array to the frontend.

---

## 5. Invitation Lifecycle & State Machine

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

### Pre- & Post-Acceptance Behavior

1. **Pre-Acceptance**:
   - Honest, generic UI: Displays "Business Team Invitation", current signed-in email, and a single "Accept Invitation" CTA button.
   - No fake claims regarding team name, inviter, or validity before server response.
2. **Post-Acceptance / Errors**:
   - **Accepted (200 OK)**: Displays "Invitation Accepted!" with direct link to "Open Business Workspace".
   - **Already Used (409)**: Displays "Invitation Already Accepted" with direct link to workspace.
   - **Expired (410 / Expired message)**: Displays "Invitation Expired" notice.
   - **Revoked (410 / Revoked message)**: Displays "Invitation Revoked" notice.
   - **Unauthenticated**: Prompts sign in with return redirect.

---

## 6. Shared Files Changed & Conflict Analysis

| Changed File | Modification Type | Conflict Risk / Guidance |
| :--- | :--- | :--- |
| `apps/web/lib/business-teams/client.ts` | Method Addition (`acceptInvite`) | Low. Added at end of `businessTeamsApiClient` object. |
| `apps/web/app/dashboard.css` | CSS Class Additions (`.dashboard-badge--*`) | Low. Added isolated rules under badge section. |
| `apps/web/components/app/business-team-panel.tsx` | Component Update | Medium. Main business team management panel. Rebased cleanly. |
| `apps/web/app/[locale]/invitations/accept/page.tsx` | New Route File | None. Feature-local route. |
| `apps/web/components/team/invitation-acceptance-screen.tsx` | New Component File | None. Feature-local component. |
| `apps/web/tests/business-team-invitations.test.ts` | New Test File | None. Isolated test suite. |

---

## 7. Security Presentation & Audit Assumptions

- **Presentation-Only Role Visibility**: Frontend checks (`userWorkspaceRole`, `canAdministerTeam`, `isOwner`) govern UI visibility and helpful guidance only. Backend middleware and API routes remain the sole authority for security enforcement.
- **Database & Schema**: Zero database migrations or schema alterations.
- **Financial / MHC / Ads**: Zero changes to financial, MHC, charging, plans, or advertisement infrastructure.
