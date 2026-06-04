# KYC runbook (Didit + manual)

- **Launch:** Didit (primary) and optional manual (admin review). Both are supported.
- **Didit:** Set `VERIFICATION_PROVIDER=didit`, `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_WORKFLOW_ID`. Configure webhook URL in Didit dashboard to `https://<API_PUBLIC_URL>/api/verification/webhook`. Test: createSession → user redirect → webhook → verification status update.
- **Manual:** Admin uses verification UI to approve/reject; no external webhook. Use for edge cases or when Didit is unavailable.
- **Idenfy:** Not launch-ready in this repo. `VERIFICATION_PROVIDER=idenfy` is blocked in production until the provider and webhook handling are completed and tested.
- **Product copy:** Show users that verification typically takes **1–5 business days**.
