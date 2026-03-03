# MohandisHub

Production-ready local foundation for an engineering services marketplace.

## Tech Stack

- Frontend: Next.js App Router, TypeScript, Tailwind CSS
- Backend: Node.js, Express (TypeScript), PostgreSQL (`pg`), Socket.io
- Monorepo: npm workspaces (`apps/*`, `packages/*`)

## Workspace Layout

```text
apps/
  api/      # Express + Socket.io backend
  web/      # Next.js frontend
packages/
  shared/   # Shared types/constants
```

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Setup environment files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Windows PowerShell equivalent:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

3. Start local development:

```bash
npm run dev
```

## Local Verification

- Frontend: http://localhost:3000
- Backend health: http://localhost:4000/health
- Localized frontend routes:
  - English: http://localhost:3000/en
  - Arabic: http://localhost:3000/ar
  - Auth (EN): http://localhost:3000/en/auth?mode=login
  - Auth (AR): http://localhost:3000/ar/auth?mode=register&role=customer
  - Root `/` redirects to the best locale (cookie or `Accept-Language`, fallback `en`).

To verify socket connectivity and see server connect/disconnect logs, run:

```bash
npm exec --yes --package socket.io-client -- node -e "const { io } = require('socket.io-client'); const socket = io('http://localhost:4000'); socket.on('connect', () => { console.log('connected', socket.id); socket.disconnect(); }); socket.on('disconnect', () => process.exit(0));"
```

## Useful Scripts

- `npm run dev` - run web + api concurrently
- `npm run dev:web` - run Next.js only
- `npm run dev:api` - run API only
- `npm run build` - build shared, api, web
- `npm run typecheck` - strict TS checks
- `npm run lint` - lint all workspaces
- `npm run test` - run tests across workspaces
- `npm run format` - format all files

## Notes

- `DATABASE_URL` is optional for booting the API, but required for any DB query paths.
- Core modules (`auth`, `users`, `services`, `wallet`, `chat`) are scaffolded for expansion.
- Current implemented endpoints:
  - `GET /health`
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/refresh`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
  - `GET /api/users`
  - `GET /api/users/:id`

```

```
