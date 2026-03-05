# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

MohandisHub is an engineering services marketplace monorepo (npm workspaces) with three packages:

- `apps/api` — Express + Socket.io backend (port 4000)
- `apps/web` — Next.js 15 frontend (port 3000)
- `packages/shared` — Shared TypeScript types/constants (must be built before other packages)

### Key commands

See `README.md` "Useful Scripts" section. Most common:

- `npm run dev` — starts both web + api concurrently (builds shared first via `predev`)
- `npm run lint` / `npm run test` / `npm run typecheck` / `npm run build` — all run across workspaces

### Non-obvious caveats

- **`OTP_SMS_PROVIDER` env var conflict:** The VM may have `OTP_SMS_PROVIDER=brevo` pre-set as a system environment variable. This value is invalid for the API's Zod schema (expects `console` or `twilio`). Since dotenv does not override existing env vars, tests and the API server will fail with "Environment validation failed". Fix: prefix commands with `OTP_SMS_PROVIDER=console` or `export OTP_SMS_PROVIDER=console` before running.
- **Shared package must be built first:** The `@mohandishub/shared` package exports from `dist/`, so it must be compiled before running other packages. The `predev` script handles this for `npm run dev`, but when running individual workspace commands you may need `npm run build -w @mohandishub/shared` first.
- **No database required for API boot:** `DATABASE_URL` is optional for starting the API, but all DB-dependent routes (auth, users, etc.) use an in-memory fallback or will error on real DB queries without Postgres.
- **Environment files:** Copy `.env.example` → `.env` (API) and `.env.example` → `.env.local` (Web) if they don't exist. Set `JWT_SECRET` and `JWT_REFRESH_SECRET` to 32+ char strings. Set `VERIFICATION_PROVIDER=manual` for local dev.
