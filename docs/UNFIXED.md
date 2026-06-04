# Unfixed / follow-up issues

Short list of known problems not yet resolved in code.

## Private upload preview: CORS when local web calls production API

**Symptom:** From origin `http://localhost:3000`, the browser blocks `fetch` / `GET` to `https://api.mohandishub.app/api/upload/private/...` with CORS: preflight fails (no `Access-Control-Allow-Origin` for localhost). Shows up in `ImagePreviewModal` (e.g. admin verifications tab).

**Why:** Production API CORS allowlist typically does not include `http://localhost:3000`.

**Directions to fix (pick one):** For a short debugging session only, add `http://localhost:3000` to the deployed API `CORS_EXTRA_ORIGINS` and remove it afterward. Prefer proxying private media through the Next app so the browser stays same-origin, or serve private files via short-lived signed URLs that work without credentialed cross-origin requests. Production no longer allows localhost credentialed CORS by default.
