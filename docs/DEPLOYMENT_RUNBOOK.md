# MohandisHub deployment runbook

Deployment targets: **Vercel** (web), **Render** (API + worker), **Supabase** (Postgres + storage).

**Production is gated:** Do not auto-deploy or auto-migrate production from CI. Run CI (including all 5 e2e journeys when `STAGING_WEB_URL` is set) before production release; then use `npm run ship` or a documented manual process to run migrations against production and deploy.

---

## 1. Environment checklist

### Web (Vercel)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Public API base URL (e.g. `https://api.mohandishub.app`) |
| `API_INTERNAL_URL` | Same as above for server-side rewrites (or leave unset to use `NEXT_PUBLIC_API_URL`) |

Set **Root Directory** to `apps/web`. Build and install are in `apps/web/vercel.json`.

### API (Render Web Service)

From `apps/api/.env.example`. Required for production:

- `NODE_ENV=production`
- `PORT=10000` (Render sets this)
- `DATABASE_URL` — Supabase connection string (pooler or direct)
- `CORS_ORIGIN` — Web app origin(s), comma-separated if multiple
- `WEB_PUBLIC_URL` — e.g. `https://mohandishub.app`
- `API_PUBLIC_URL` — e.g. `https://api.mohandishub.app` (for webhooks, emails)
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — min 32 chars, generate securely
- `VERIFICATION_PROVIDER`, `DIDIT_*` — KYC
- `OTP_EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM`
- `NOWPAYMENTS_*` — deposits + withdrawals
- `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` — if using calls

### Worker (Render Background Worker)

Same repo; same build. Start command should run the worker entrypoint (for example `npm run worker` from `apps/api`), **not** only `npm start` (HTTP server). The worker process runs **reservation lifecycle sweeps** and **data retention sweeps** (plus any other scheduled jobs). Required env vars overlap with the API: at minimum `DATABASE_URL`, `JWT_SECRET`, and `JWT_REFRESH_SECRET`, plus optional `RETENTION_*` variables from `apps/api/.env.example` when you want automated cleanup. Include any NOWPayments (or other) keys if the worker touches those code paths.

### Supabase

- **Database:** Use Project Settings → Database for `DATABASE_URL`. Prefer **connection pooler** for API; ensure project is not paused.
- **Storage:** Create buckets (e.g. `verification-docs`, `uploads`) and configure RLS; see storage section below.

---

## 2. Migrations

- **Staging:** Run in CI on push/PR or on merge to `main` against staging DB (`DATABASE_URL` secret for staging).
- **Production:** **Gated / manual only.** Do **not** auto-run migrations against production from CI.
  - Option A: From a trusted machine, set `DATABASE_URL` to production and run: `npx supabase db push` (or from repo root with Supabase CLI linked to prod).
  - Option B: Use `npm run ship` which runs `supabase db push` after typecheck/lint/build; run ship only when intentionally releasing to production.

---

## 3. Rollback

- **Vercel:** Use dashboard to promote a previous deployment or revert the last deployment.
- **Render:** Redeploy a previous commit from the dashboard or re-run deploy for the last known-good commit.
- **Database:** Supabase point-in-time recovery; restore from backup if a migration must be reverted. Prefer backward-compatible migrations (add columns/tables first; drop later).

---

## 4. Health and readiness

- **API:** `GET /health` — returns 200 and optional `database: ok`. Use for liveness.
- **Readiness:** `GET /health/ready` — returns 200 when DB is reachable, 503 when DB is down. Use this for Render **health check path** so the service is marked unhealthy when DB is unavailable.

---

## 5. Domain and SSL

- **Web:** Attach custom domain in Vercel (e.g. `mohandishub.app`); SSL is automatic.
- **API:** Attach custom domain in Render (e.g. `api.mohandishub.app`); SSL is automatic. Set `CORS_ORIGIN` and `API_PUBLIC_URL` to match.

---

## 6. Storage (Supabase)

- Migration `20260316000000_storage_buckets.sql` creates buckets `uploads` (public) and `verification-docs` (private). Run migrations so these exist.
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the API env (Render). When set, `POST /api/upload` stores files in Supabase Storage instead of local disk.
- **Public vs private:** Use `POST /api/upload` for non-sensitive assets (returned URL is public). Use `POST /api/upload/private` for verification docs and CVs; files go to `verification-docs` (private bucket). The API returns an API path (e.g. `/api/upload/private/:id`), not a public URL. Access is via `GET /api/upload/private/:id` with auth (owner, admin, or job owner for CVs). Run migration `20260317000000_private_uploads.sql` for the private-uploads table.
- Configure RLS policies per bucket in Dashboard if needed (e.g. service role for API uploads). API uses service role for uploads.
- Avoid storing files on Render disk (ephemeral); use Supabase Storage in production.

---

## 7. Backup and restore

- **Supabase:** Use Supabase Dashboard → Database → Backups. Pro plans get point-in-time recovery (PITR). Document backup schedule and retention.
- **Restore:** Supabase Dashboard → Backups → select point in time (if PITR) or backup snapshot. Restore creates a new project or overwrites; document who can perform restore and how (e.g. new project + repoint env).
- **Runbook:** Keep a short internal note: "Restore from backup: 1) Supabase Dashboard → Backups, 2) Restore to new project or contact support for overwrite, 3) Update production DATABASE_URL if restored to new project, 4) Run migrations if schema changed after backup."

---

## 8. Secrets

- Never commit secrets. Use Vercel env vars, Render env vars (or Secret Files), and Supabase env as needed.
- Rotate `JWT_SECRET` / `JWT_REFRESH_SECRET` with care; coordinate with existing sessions if needed.
