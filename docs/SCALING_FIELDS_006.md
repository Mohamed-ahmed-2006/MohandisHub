# Migration 006 — Future-proof fields (before scaling)

This document describes the fields added in `006_future_proof_fields.sql` and how to use them as you scale.

## Why add these now?

Adding columns later on large tables is harder (locks, backfills, app rollout). These are nullable or have safe defaults, so existing code keeps working. You can start using them when you implement each feature.

---

## 1. Users table

| Column              | Type                               | Purpose                                                                                                                     |
| ------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `locale`            | VARCHAR(10) DEFAULT 'en'           | Preferred UI language (en/ar). Use instead of only `Accept-Language`.                                                       |
| `time_zone`         | VARCHAR(50) DEFAULT 'Africa/Cairo' | IANA timezone for scheduling, notifications, “last active”.                                                                 |
| `last_login_at`     | TIMESTAMPTZ                        | Set on every successful login. Use for security, analytics, “last seen”.                                                    |
| `accepted_terms_at` | TIMESTAMPTZ                        | When the user accepted the current Terms & Conditions.                                                                      |
| `terms_version`     | VARCHAR(20)                        | Version of terms accepted (e.g. `2024-01`). Store the same version in your app when you update terms.                       |
| `deleted_at`        | TIMESTAMPTZ                        | Soft delete. `NULL` = active. **Important:** all user-facing queries should add `WHERE deleted_at IS NULL` (or use a view). |

**Suggested usage:**

- **Registration:** Set `accepted_terms_at = now()` and `terms_version = '<current_version>'` when they accept T&C.
- **Login:** Update `last_login_at = now()` (and optionally store IP in app/audit if needed).
- **Settings:** Let users set `locale` and `time_zone`; use them for emails and in-app copy.
- **GDPR / delete:** Set `deleted_at = now()` and anonymize PII instead of hard delete; keep audit trail.

---

## 2. Customer profiles

| Column                     | Type               | Purpose                                                                                                                  |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `notification_preferences` | JSONB DEFAULT '{}' | Channels: `email`, `push`, `sms`, `marketing`. e.g. `{ "email": true, "push": true, "sms": false, "marketing": false }`. |

Use when building notification and marketing consent. Shared type: `CustomerNotificationPreferences` in `@mohandishub/shared`.

---

## 3. Expert & Business profiles

| Column                 | Type                         | Purpose                                                                                      |
| ---------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `profile_visibility`   | VARCHAR(20) DEFAULT 'public' | `public` = in search; `unlisted` = by link only; `draft` = not visible.                      |
| `profile_completed_at` | TIMESTAMPTZ                  | When onboarding was completed. Use for funnel analytics and “complete your profile” prompts. |

Set `profile_completed_at` when the expert/business finishes the last onboarding step. Use `profile_visibility` to hide unfinished or private profiles from search. Shared type: `ProfileVisibility` in `@mohandishub/shared`.

---

## 4. Plans table

| Column        | Type                 | Purpose                                                             |
| ------------- | -------------------- | ------------------------------------------------------------------- |
| `description` | TEXT                 | Display description for the plan.                                   |
| `is_active`   | BOOLEAN DEFAULT true | Hide from selection without deleting; existing users keep the plan. |
| `sort_order`  | SMALLINT DEFAULT 0   | Display order in admin and signup (lower = first).                  |

When you add paid plans, filter with `WHERE is_active = true ORDER BY sort_order`. Retire a plan by setting `is_active = false` instead of deleting.

---

## Optional fields you might add later

- **Users:** `invited_by_user_id`, `signup_source` (e.g. web, app, referral) for growth analytics.
- **Experts:** `rating_avg`, `reviews_count` (or compute from a `reviews` table) for ranking.
- **Plans:** `price`, `currency`, `interval` (monthly/yearly) when you add paid billing.
- **Security:** Failed-login count / lockout are often better in Redis or app state than in the DB.

Run migration `006_future_proof_fields.sql` after `005_plans.sql`. No application code is required to stay working; use the new columns when you implement each feature.
