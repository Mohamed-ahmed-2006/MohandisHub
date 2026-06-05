import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Comma-separated origins also supported (e.g. "https://mohandishub.app,https://www.mohandishub.app")
  CORS_EXTRA_ORIGINS: z.string().optional(),
  API_PUBLIC_URL: z.string().url().optional(),
  WEB_PUBLIC_URL: z.string().url().optional(),

  // Behind one reverse-proxy hop (Render, nginx, etc.): set TRUST_PROXY=1 so rate limits use the real client IP.
  TRUST_PROXY: z.string().optional(),
  // Optional overrides for express-rate-limit (per IP). Defaults match apps/api/src/middleware/rate-limit.ts.
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),

  // Auth / JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.coerce.number().int().positive().default(900), // 15 min
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30), // 30 days

  /**
   * Set to 1 if this API is served over HTTPS with a cross-origin web app but NODE_ENV is not
   * production (e.g. NODE_ENV=development in Render env overrides the blueprint). Enables
   * SameSite=None + Secure on the refresh cookie; see apps/api/src/config/cookies.ts.
   */
  AUTH_CROSS_SITE_REFRESH_COOKIE: z
    .string()
    .default('0')
    .transform((s) => s === '1' || s.toLowerCase() === 'true'),

  // Verification provider
  VERIFICATION_PROVIDER: z.enum(['didit', 'idenfy', 'manual']).default('manual'),
  IDENFY_API_KEY: z.string().optional(),
  IDENFY_API_SECRET: z.string().optional(),

  // Didit KYC
  DIDIT_API_KEY: z.string().optional(),
  DIDIT_WEBHOOK_SECRET: z.string().optional(),
  DIDIT_WORKFLOW_ID: z.string().uuid().optional(),
  DIDIT_BASE_URL: z.string().url().default('https://verification.didit.me/v3'),

  // OTP delivery providers
  OTP_EMAIL_PROVIDER: z.enum(['console', 'brevo', 'sendgrid']).default('console'),
  OTP_SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
  BREVO_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@mohandishub.app'),
  EMAIL_LOGO_URL: z.string().url().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Cryptomus — crypto payments (wallet deposit)
  CRYPTOMUS_MERCHANT_ID: z.string().uuid().optional(),
  CRYPTOMUS_API_KEY: z.string().optional(),
  CRYPTOMUS_WEBHOOK_KEY: z.string().optional(),

  // Stripe — card payments (wallet deposit)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // NOWPayments — deposits + payouts
  NOWPAYMENTS_API_KEY: z.string().optional(),
  NOWPAYMENTS_IPN_SECRET: z.string().optional(),
  NOWPAYMENTS_AUTH_EMAIL: z.string().email().optional(),
  NOWPAYMENTS_AUTH_PASSWORD: z.string().optional(),
  NOWPAYMENTS_FIAT_ENABLED: z.coerce.boolean().default(false),
  NOWPAYMENTS_CUSTODY_ENABLED: z.coerce.boolean().default(false),
  NOWPAYMENTS_MASS_PAYOUTS_ENABLED: z.coerce.boolean().default(false),
  NOWPAYMENTS_WITHDRAWALS_ENABLED: z.coerce.boolean().default(false),
  NOWPAYMENTS_MANUAL_PAYOUT_VERIFY: z.coerce.boolean().default(true),
  NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT: z.coerce.number().positive().default(20),
  NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY: z.string().default('USDTTRC20'),
  NOWPAYMENTS_ALLOWED_PAY_CURRENCIES: z.string().optional(),
  NOWPAYMENTS_LIVE_REQUIRED: z.coerce.boolean().default(true),

  // Paymob — EGP card/wallet deposits + payout/disbursement (no FX; EGP-native)
  PAYMOB_SECRET_KEY: z.string().optional(),
  PAYMOB_PUBLIC_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  // Comma-separated integration ids enabled on the Paymob unified intention.
  PAYMOB_INTEGRATION_IDS: z.string().optional(),
  PAYMOB_API_BASE_URL: z.string().url().default('https://accept.paymob.com'),
  PAYMOB_DEPOSITS_ENABLED: z.coerce.boolean().default(false),
  PAYMOB_WITHDRAWALS_ENABLED: z.coerce.boolean().default(false),
  // Payout/disbursement API (separate Paymob product/credentials).
  PAYMOB_PAYOUT_CLIENT_ID: z.string().optional(),
  PAYMOB_PAYOUT_CLIENT_SECRET: z.string().optional(),
  PAYMOB_PAYOUT_BASE_URL: z.string().url().default('https://stagingpayouts.paymobsolutions.com'),

  // Agora RTC
  AGORA_APP_ID: z.string().optional(),
  AGORA_APP_CERTIFICATE: z.string().optional(),

  // Supabase Storage (optional; when set, uploads go to Supabase instead of local disk)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Sentry (optional; when set, 5xx and unhandled errors are reported)
  SENTRY_DSN: z.string().url().optional(),

  // Data retention — sweep interval and per-entity retention (0 = never delete / skip)
  RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(900_000), // 15 min
  RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS: z.coerce.number().int().min(0).default(24),
  RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS: z.coerce.number().int().min(0).default(24),
  RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS: z.coerce.number().int().min(0).default(7),
  RETENTION_VERIFICATION_REQUESTS_DAYS: z.coerce.number().int().min(0).default(90),
  RETENTION_CHAT_MESSAGES_DAYS: z.coerce.number().int().min(0).default(0),
  /** Unsafe for global orphan scan; logged as no-op when > 0 until prefix strategy exists. */
  RETENTION_UPLOADS_DAYS: z.coerce.number().int().min(0).default(0),
  RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED: z.coerce.number().int().min(0).default(0),
  RETENTION_BID_MESSAGE_ATTACHMENT_DAYS: z.coerce.number().int().min(0).default(0),
  RETENTION_VERIFIED_PRIVATE_UPLOADS_DAYS: z.coerce.number().int().min(0).default(0),

  /** Hard ceiling for public upload size (bytes). Admin/settings cannot exceed this. */
  PUBLIC_UPLOAD_MAX_BYTES_CEILING: z.coerce.number().int().positive().default(52_428_800), // 50 * 1024 * 1024
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

if (parsed.data.NODE_ENV === 'production') {
  const productionErrors: Record<string, string[]> = {};
  if (parsed.data.OTP_EMAIL_PROVIDER === 'console') {
    productionErrors.OTP_EMAIL_PROVIDER = ['Production must use a real email provider. Set OTP_EMAIL_PROVIDER=brevo.'];
  }
  if (parsed.data.OTP_EMAIL_PROVIDER === 'sendgrid') {
    productionErrors.OTP_EMAIL_PROVIDER = ['SendGrid email is not implemented for production. Use brevo or implement SendGrid first.'];
  }
  if (parsed.data.OTP_SMS_PROVIDER === 'twilio') {
    productionErrors.OTP_SMS_PROVIDER = ['Twilio SMS is not implemented for production. Use console only for non-production or implement Twilio first.'];
  }
  if (parsed.data.VERIFICATION_PROVIDER === 'idenfy') {
    productionErrors.VERIFICATION_PROVIDER = ['Idenfy verification is not implemented for production. Use didit or manual.'];
  }
  if (parsed.data.NOWPAYMENTS_LIVE_REQUIRED) {
    if (!parsed.data.NOWPAYMENTS_API_KEY) {
      productionErrors.NOWPAYMENTS_API_KEY = ['NOWPayments API key is required for production wallet deposits.'];
    }
    if (!parsed.data.NOWPAYMENTS_IPN_SECRET) {
      productionErrors.NOWPAYMENTS_IPN_SECRET = ['NOWPayments IPN secret is required so deposits and payouts cannot be spoofed.'];
    }
    if (!parsed.data.API_PUBLIC_URL) {
      productionErrors.API_PUBLIC_URL = ['API_PUBLIC_URL is required for NOWPayments IPN callback URLs.'];
    }
    if (!parsed.data.WEB_PUBLIC_URL) {
      productionErrors.WEB_PUBLIC_URL = ['WEB_PUBLIC_URL is required for trusted checkout return URLs.'];
    }
  }
  if (parsed.data.NOWPAYMENTS_WITHDRAWALS_ENABLED || parsed.data.NOWPAYMENTS_MASS_PAYOUTS_ENABLED) {
    if (!parsed.data.NOWPAYMENTS_WITHDRAWALS_ENABLED || !parsed.data.NOWPAYMENTS_MASS_PAYOUTS_ENABLED) {
      productionErrors.NOWPAYMENTS_WITHDRAWALS_ENABLED = [
        'NOWPayments crypto withdrawals require both NOWPAYMENTS_WITHDRAWALS_ENABLED=true and NOWPAYMENTS_MASS_PAYOUTS_ENABLED=true.',
      ];
    }
    if (!parsed.data.NOWPAYMENTS_API_KEY) {
      productionErrors.NOWPAYMENTS_API_KEY = ['NOWPayments API key is required for crypto withdrawals.'];
    }
    if (!parsed.data.NOWPAYMENTS_AUTH_EMAIL || !parsed.data.NOWPAYMENTS_AUTH_PASSWORD) {
      productionErrors.NOWPAYMENTS_AUTH_EMAIL = ['NOWPayments auth email/password are required for mass-payout withdrawals.'];
    }
  }
  if (parsed.data.PAYMOB_DEPOSITS_ENABLED) {
    if (!parsed.data.PAYMOB_SECRET_KEY || !parsed.data.PAYMOB_PUBLIC_KEY) {
      productionErrors.PAYMOB_SECRET_KEY = ['Paymob secret + public keys are required when PAYMOB_DEPOSITS_ENABLED=true.'];
    }
    if (!parsed.data.PAYMOB_HMAC_SECRET) {
      productionErrors.PAYMOB_HMAC_SECRET = ['Paymob HMAC secret is required so deposit callbacks cannot be spoofed.'];
    }
    if (!parsed.data.PAYMOB_INTEGRATION_IDS) {
      productionErrors.PAYMOB_INTEGRATION_IDS = ['At least one Paymob integration id is required for the unified checkout.'];
    }
  }
  if (parsed.data.PAYMOB_WITHDRAWALS_ENABLED) {
    if (!parsed.data.PAYMOB_PAYOUT_CLIENT_ID || !parsed.data.PAYMOB_PAYOUT_CLIENT_SECRET) {
      productionErrors.PAYMOB_PAYOUT_CLIENT_ID = ['Paymob payout client id/secret are required when PAYMOB_WITHDRAWALS_ENABLED=true.'];
    }
  }
  if (Object.keys(productionErrors).length > 0) {
    console.error('Invalid production provider configuration', productionErrors);
    throw new Error('Production provider configuration failed');
  }
}

export const env = parsed.data;
