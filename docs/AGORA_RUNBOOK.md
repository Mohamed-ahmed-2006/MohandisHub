# Agora RTC runbook

- **Env:** Set `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` in production (API env).
- **Channel naming:** Include reservationId (or similar) in channel name for traceability and abuse limits.
- **Token expiry:** Use a short-lived token (e.g. 1 hour) for sessions.
- **Optional:** Add server-side checks that the user is in the reservation before issuing a token.
