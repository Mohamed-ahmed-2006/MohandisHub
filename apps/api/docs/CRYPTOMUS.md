# Cryptomus integration (crypto payments)

To link crypto payments with the API using Cryptomus, you need the following.

## What you need from Cryptomus

1. **Merchant UUID**
   - In Cryptomus: open your **Merchant** (or **Settings**), find **Merchant ID**.
   - It’s a UUID, e.g. `8b03432e-385b-4670-8d06-064591096795`.

2. **Payment API key**
   - In **Settings → API keys**, create/copy the **Payment API key** (used to create invoices and accept payments).
   - Keep it secret; never commit it or expose it to the frontend.

3. **Webhook key (optional)**
   - Used to verify that webhook callbacks really come from Cryptomus.
   - Often the same as the Payment API key; some setups use a separate key from webhook settings.

## Environment variables

In `apps/api/.env` (or your env source), set:

```env
CRYPTOMUS_MERCHANT_ID=your-merchant-uuid
CRYPTOMUS_API_KEY=your-payment-api-key
# Optional; defaults to API key if not set
CRYPTOMUS_WEBHOOK_KEY=your-webhook-key
# Optional; base URL of your API for webhook callback (e.g. https://api.yourdomain.com). Defaults to CORS_ORIGIN.
API_PUBLIC_URL=https://api.yourdomain.com
```

- **CRYPTOMUS_MERCHANT_ID** — Merchant UUID from Cryptomus.
- **CRYPTOMUS_API_KEY** — Payment API key from Cryptomus.
- **CRYPTOMUS_WEBHOOK_KEY** — (Optional) Key used to verify webhook `sign`. If unset, the app uses `CRYPTOMUS_API_KEY`.

## Cryptomus setup checklist

1. Create a Cryptomus account and complete merchant verification if required.
2. Confirm your domain in Cryptomus (needed for live payments).
3. Copy **Merchant ID** and **Payment API key** into the env vars above.
4. In Cryptomus, set the **Webhook URL** to your API, e.g.:  
   `https://your-api-domain.com/api/wallet/cryptomus-webhook`  
   (exact path depends on how the wallet webhook route is mounted.)
5. Ensure your server is reachable by Cryptomus (HTTPS in production).

## API behavior (high level)

- **Create deposit (invoice)**  
  The API will call Cryptomus `POST /v1/payment` with `amount`, `currency`, `order_id`, and `url_callback` (your webhook URL).  
  Requests are signed with: `sign = MD5(base64_encode(body) + API_KEY)` and header `merchant: <CRYPTOMUS_MERCHANT_ID>`.

- **Webhook**  
  When a payment is completed (or status changes), Cryptomus sends a POST to your webhook URL.  
  The API verifies the `sign` header using `CRYPTOMUS_WEBHOOK_KEY` (or `CRYPTOMUS_API_KEY`) and then credits the user’s wallet and records the transaction.

Once `CRYPTOMUS_MERCHANT_ID` and `CRYPTOMUS_API_KEY` are set, the wallet deposit flow can create Cryptomus invoices and handle callbacks; add the webhook route and wallet-credit logic as implemented in the codebase.
