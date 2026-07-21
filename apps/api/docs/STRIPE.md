# Stripe Integration Guide (Credit/Debit Cards)

This document describes how to add Stripe for credit/debit card payments to MohandisHub. The project currently uses Cryptomus for crypto deposits; Stripe would complement this for card payments.

## Overview

Stripe provides:

- **Payment Intents** — recommended for one-time card payments
- **Setup Intents** — for saving cards for future use
- **Customer Portal** — for managing saved payment methods

## 1. Install Stripe

```bash
cd apps/api
npm install stripe
```

## 2. Webhook Events to Select

When creating your webhook in Stripe Dashboard (Developers → Webhooks → Add endpoint), select these events:

| Event                            | Purpose                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **`checkout.session.completed`** | Required — fires when customer completes payment via Stripe Checkout. Use this to credit the wallet. |
| **`payment_intent.succeeded`**   | Optional — use if you use Payment Intents directly (embedded form) instead of Checkout.              |

**Minimum:** Select `checkout.session.completed` — that's all you need for the Checkout flow.

## 3. Environment Variables

Add to `apps/api/.env`:

```
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
```

Add to `apps/api/src/config/env.ts` (in the env schema):

```ts
STRIPE_SECRET_KEY: z.string().optional(),
STRIPE_WEBHOOK_SECRET: z.string().optional(),
STRIPE_PUBLISHABLE_KEY: z.string().optional(),
```

## 4. Create Stripe Client

Create `apps/api/src/lib/stripe.client.ts`:

```ts
import Stripe from 'stripe';
import { env } from '../config/env.js';

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' })
  : null;
```

## 5. Database: Store Stripe Customer ID

Add a migration to link users to Stripe customers:

```sql
-- Migration: add_stripe_customer_id.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
```

## 6. API Endpoints

### Create Payment Intent (for deposit)

```ts
// POST /api/wallet/stripe/create-payment-intent
// Body: { amount: number, currency?: string }
// Creates a PaymentIntent for wallet deposit
```

### Webhook (for payment confirmation)

```ts
// POST /api/wallet/stripe-webhook
// Raw body, verify signature with STRIPE_WEBHOOK_SECRET
// On payment_intent.succeeded → credit user wallet
```

### Save Card (optional, for recurring)

```ts
// POST /api/wallet/stripe/setup-intent
// Creates SetupIntent for adding a card
// Store payment method to Stripe Customer for future use
```

## 7. Frontend (Stripe Elements)

1. Add Stripe.js to the web app:

```bash
cd apps/web
npm install @stripe/stripe-js @stripe/react-stripe-js
```

2. Create a payment form using `CardElement` or `PaymentElement`:

```tsx
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
```

3. Flow:
   - User enters amount
   - Frontend calls API to create PaymentIntent (get `client_secret`)
   - Frontend confirms payment with `stripe.confirmCardPayment(client_secret, { payment_method: { card: elements.getElement(CardElement) } })`
   - Webhook receives `payment_intent.succeeded` and credits wallet

## 8. Security

- **Never** send card numbers to your server — Stripe.js handles card data
- Use **webhook signature verification** for all webhook events
- Store only `stripe_customer_id` and `payment_method_id` — never card details

## 9. Testing

Use Stripe test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (decline).

### Local development — webhooks

Stripe cannot reach `localhost`. To test deposits locally, forward webhooks with Stripe CLI:

```bash
stripe listen --forward-to localhost:4000/api/wallet/stripe-webhook
```

Use the webhook signing secret printed by the CLI (starts with `whsec_`) in your `.env` as `STRIPE_WEBHOOK_SECRET`. Without this, the webhook never fires and the wallet balance will not update after checkout.

## 10. Production Checklist

- [ ] Replace test keys with live keys
- [ ] Configure webhook endpoint in Stripe Dashboard
- [ ] Enable 3D Secure (SCA) for EU compliance
- [ ] Add idempotency for webhook processing

## 11. Troubleshooting: Balance Not Updating After Deposit

If Stripe shows the payment as successful but the wallet balance does not update:

### 1. Webhook URL (Production)

In **Stripe Dashboard → Developers → Webhooks**, ensure the endpoint URL is correct:

- **Production:** `https://api.mohandishub.app/api/wallet/stripe-webhook`
- **Local:** Use `stripe listen --forward-to localhost:4000/api/wallet/stripe-webhook` (Stripe cannot reach localhost directly)

### 2. Webhook Signing Secret

`STRIPE_WEBHOOK_SECRET` in `apps/api/.env` must match the webhook's signing secret:

- **Production:** Copy from Stripe Dashboard → Webhooks → your endpoint → "Signing secret"
- **Local:** Use the secret printed when you run `stripe listen` (starts with `whsec_`)

If the secret is wrong, the webhook returns 400 and the wallet is never credited.

### 3. API Reachability

The API must be reachable at the webhook URL. For production, ensure `api.mohandishub.app` resolves and the API is running.

### 4. Frontend API URL

The frontend fetches balance from the API. Ensure:

- **Production:** `NEXT_PUBLIC_API_URL` (or `API_INTERNAL_URL` for Next.js rewrites) points to `https://api.mohandishub.app`
- **Local:** `NEXT_PUBLIC_API_URL=http://localhost:4000` if the frontend runs on a different port

If the frontend calls the wrong URL, it will not receive the updated balance.

### 5. Manual Refresh

After a successful deposit, use the **↻** (refresh) button next to the balance to refetch. The webhook can take a few seconds; polling runs for ~60s, but manual refresh helps if it was slow.
