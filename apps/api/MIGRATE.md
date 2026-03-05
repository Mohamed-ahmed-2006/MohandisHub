# Database migrations

The API needs a PostgreSQL database and **all migrations applied** before auth (register/login) works. The 500 on register usually means the DB is missing the `plans` table or columns like `accepted_terms_at` (migrations 005 and 006).

## 1. Create the database

Create an empty PostgreSQL database (local or cloud, e.g. Supabase, Neon). Note the connection URL.

## 2. Configure environment

Copy the example env and set `DATABASE_URL`:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and set:

- `DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE`
- `JWT_SECRET` and `JWT_REFRESH_SECRET` to long random strings (at least 32 characters)

## 3. Run migrations

From the **repo root**:

```bash
npm run migrate -w @mohandishub/api
```

Or from `apps/api`:

```bash
npm run migrate
```

You should see output like:

```
Running: 001_auth_schema.sql
Done: 001_auth_schema.sql
Running: 002_otp_schema.sql
...
Running: 006_future_proof_fields.sql
Done: 006_future_proof_fields.sql
Migrations finished.
```

## 4. If you already had tables (e.g. ran SQL by hand before)

If the database already has `users` and other tables but no `plans` table:

1. Connect to the DB (psql, Supabase SQL editor, etc.) and create the migrations tracker, then mark what’s already applied:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY);

-- Mark migrations you already applied (adjust the list to match what you ran):
INSERT INTO schema_migrations (version) VALUES
  ('001_auth_schema'),
  ('002_otp_schema'),
  ('003_users_birth_date'),
  ('004_enhanced_profiles')
ON CONFLICT (version) DO NOTHING;
```

2. Run the migrate script again so only 005 and 006 run:

```bash
npm run migrate -w @mohandishub/api
```

## Order of migrations

| File                        | Purpose                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| 001_auth_schema.sql         | users, refresh_tokens, customer/expert/business profiles, verification_requests                          |
| 002_otp_schema.sql          | OTP/email verification tables                                                                            |
| 003_users_birth_date.sql    | date_of_birth + min age constraint on users                                                              |
| 004_enhanced_profiles.sql   | identity_documents, academic_records, extra profile fields, admin role                                   |
| 005_plans.sql               | plans table, users.plan_id (default free)                                                                |
| 006_future_proof_fields.sql | locale, time_zone, last_login_at, accepted_terms_at, terms_version, deleted_at, profile_visibility, etc. |

Register needs at least **005** and **006** to be applied so `users` has `plan_id`, `accepted_terms_at`, and `terms_version`, and so `findUserByEmail` can join `plans` and filter by `deleted_at`.
