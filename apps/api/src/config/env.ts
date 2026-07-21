import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const booleanEnv = (defaultValue: boolean) =>
  z
    .preprocess((value) => {
      if (value === undefined || value === null || value === '') return undefined;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      }
      return value;
    }, z.boolean())
    .default(defaultValue);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Comma-separated origins also supported (e.g. "https://mohandishub.app,https://www.mohandishub.app")
  CORS_EXTRA_ORIGINS: z.string().optional(),
  API_PUBLIC_URL: z.string().url().optional(),
  WEB_PUBLIC_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().max(50).default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

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
    .preprocess((value) => {
      if (value === undefined || value === null || value === '') return undefined;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      }
      return value;
    }, z.boolean())
    .default(false),
  ALLOW_FACTORY_RESET: booleanEnv(false),

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
  OTP_EMAIL_PROVIDER: z.enum(['console', 'brevo', 'resend', 'sendgrid']).default('console'),
  OTP_SMS_PROVIDER: z
    .enum(['console', 'twilio', 'http_adapter', 'meta_whatsapp'])
    .default('console'),
  BREVO_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@mohandishub.app'),
  EMAIL_LOGO_URL: z.string().url().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  SMS_HTTP_ENDPOINT: z.string().url().optional(),
  SMS_HTTP_API_KEY: z.string().optional(),
  SMS_HTTP_FROM: z.string().optional(),
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_OTP_TEMPLATE: z.string().default('mohandishub_otp'),
  META_WHATSAPP_LANGUAGE: z.string().default('en_US'),

  // Web Push (PWA/browser push). Keys stay in env; subscriptions are stored per device.
  WEB_PUSH_ENABLED: booleanEnv(false),
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().optional(),

  // Backup/restore provider API. Restore is admin-gated and provider-driven.
  BACKUP_PROVIDER: z.enum(['disabled', 'supabase', 'custom_http']).default('disabled'),
  BACKUP_SUPABASE_PROJECT_REF: z.string().optional(),
  BACKUP_SUPABASE_ACCESS_TOKEN: z.string().optional(),
  BACKUP_SUPABASE_BASE_URL: z.string().url().default('https://api.supabase.com'),
  BACKUP_CUSTOM_BASE_URL: z.string().url().optional(),
  BACKUP_CUSTOM_API_KEY: z.string().optional(),
  BACKUP_CUSTOM_STATUS_PATH: z.string().default('/status'),
  BACKUP_CUSTOM_LIST_PATH: z.string().default('/backups'),
  BACKUP_CUSTOM_DRY_RUN_PATH: z.string().default('/restores/dry-run'),
  BACKUP_CUSTOM_RESTORE_PATH: z.string().default('/restores'),

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
  NOWPAYMENTS_FIAT_ENABLED: booleanEnv(false),
  NOWPAYMENTS_CUSTODY_ENABLED: booleanEnv(false),
  NOWPAYMENTS_MASS_PAYOUTS_ENABLED: booleanEnv(false),
  NOWPAYMENTS_WITHDRAWALS_ENABLED: booleanEnv(false),
  NOWPAYMENTS_MANUAL_PAYOUT_VERIFY: booleanEnv(false),
  NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT: z.coerce.number().positive().default(20),
  NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY: z.string().default('USDTTRC20'),
  NOWPAYMENTS_ALLOWED_PAY_CURRENCIES: z.string().optional(),
  // When true, production startup requires NOWPayments deposit keys + public URLs.
  // Keep false until crypto/card deposits are enabled and keys are configured.
  NOWPAYMENTS_LIVE_REQUIRED: booleanEnv(false),

  // Paymob — EGP card/wallet deposits + payout/disbursement (no FX; EGP-native)
  PAYMOB_SECRET_KEY: z.string().optional(),
  PAYMOB_PUBLIC_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  // Comma-separated integration ids enabled on the Paymob unified intention.
  PAYMOB_INTEGRATION_IDS: z.string().optional(),
  PAYMOB_API_BASE_URL: z.string().url().default('https://accept.paymob.com'),
  PAYMOB_DEPOSITS_ENABLED: booleanEnv(false),
  PAYMOB_WITHDRAWALS_ENABLED: booleanEnv(false),
  // Payout/disbursement API (separate Paymob product/credentials).
  PAYMOB_PAYOUT_CLIENT_ID: z.string().optional(),
  PAYMOB_PAYOUT_CLIENT_SECRET: z.string().optional(),
  PAYMOB_PAYOUT_BASE_URL: z.string().url().optional(),

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
  /** Purge accounts that never verified their email after N days (0 = disabled). Never touches admins or verified users. */
  RETENTION_UNVERIFIED_ACCOUNTS_DAYS: z.coerce.number().int().min(0).default(0),

  /** Hard ceiling for public upload size (bytes). Admin/settings cannot exceed this. */
  PUBLIC_UPLOAD_MAX_BYTES_CEILING: z.coerce.number().int().positive().default(52_428_800), // 50 * 1024 * 1024
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

const looksLikePlaceholderSecret = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes('change-me') ||
    normalized.includes('changeme') ||
    normalized.includes('placeholder') ||
    normalized.includes('your-secret') ||
    normalized.includes('your_random_secret') ||
    normalized.includes('replace-me')
  );
};

if (parsed.data.NODE_ENV === 'production') {
  const productionErrors: Record<string, string[]> = {};
  if (looksLikePlaceholderSecret(parsed.data.JWT_SECRET)) {
    productionErrors.JWT_SECRET = [
      'JWT_SECRET appears to be a copied placeholder. Generate a unique random production secret.',
    ];
  }
  if (looksLikePlaceholderSecret(parsed.data.JWT_REFRESH_SECRET)) {
    productionErrors.JWT_REFRESH_SECRET = [
      'JWT_REFRESH_SECRET appears to be a copied placeholder. Generate a unique random production secret.',
    ];
  }
  if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    productionErrors.JWT_REFRESH_SECRET = [
      'JWT_REFRESH_SECRET must be different from JWT_SECRET so access-token signing and opaque-token hashing use separate keys.',
    ];
  }
  if (!parsed.data.DATABASE_URL) {
    productionErrors.DATABASE_URL = ['DATABASE_URL is required in production.'];
  }
  if (!parsed.data.API_PUBLIC_URL) {
    productionErrors.API_PUBLIC_URL = ['API_PUBLIC_URL is required in production.'];
  }
  if (!parsed.data.WEB_PUBLIC_URL) {
    productionErrors.WEB_PUBLIC_URL = ['WEB_PUBLIC_URL is required in production.'];
  }
  if (!parsed.data.SENTRY_DSN) {
    productionErrors.SENTRY_DSN = [
      'SENTRY_DSN is required in production for API and worker error visibility.',
    ];
  }
  if (parsed.data.OTP_EMAIL_PROVIDER === 'console') {
    productionErrors.OTP_EMAIL_PROVIDER = [
      'Production must use a real email provider. Set OTP_EMAIL_PROVIDER=resend.',
    ];
  }
  if (parsed.data.OTP_EMAIL_PROVIDER === 'sendgrid') {
    productionErrors.OTP_EMAIL_PROVIDER = [
      'SendGrid email is not implemented for production. Use resend or implement SendGrid first.',
    ];
  }
  if (parsed.data.OTP_EMAIL_PROVIDER === 'brevo' && !parsed.data.BREVO_API_KEY) {
    productionErrors.BREVO_API_KEY = [
      'BREVO_API_KEY is required when OTP_EMAIL_PROVIDER=brevo in production.',
    ];
  }
  if (parsed.data.OTP_EMAIL_PROVIDER === 'resend') {
    if (!parsed.data.RESEND_API_KEY) {
      productionErrors.RESEND_API_KEY = [
        'RESEND_API_KEY is required when OTP_EMAIL_PROVIDER=resend in production.',
      ];
    }
    if (!process.env.EMAIL_FROM?.trim()) {
      productionErrors.EMAIL_FROM = [
        'EMAIL_FROM is required when OTP_EMAIL_PROVIDER=resend in production.',
      ];
    }
  }
  if (parsed.data.OTP_SMS_PROVIDER === 'twilio') {
    if (
      !parsed.data.TWILIO_ACCOUNT_SID ||
      !parsed.data.TWILIO_AUTH_TOKEN ||
      !parsed.data.TWILIO_PHONE_NUMBER
    ) {
      productionErrors.OTP_SMS_PROVIDER = [
        'Twilio SMS requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.',
      ];
    }
  }
  if (
    parsed.data.OTP_SMS_PROVIDER === 'http_adapter' &&
    (!parsed.data.SMS_HTTP_ENDPOINT || !parsed.data.SMS_HTTP_API_KEY)
  ) {
    productionErrors.OTP_SMS_PROVIDER = [
      'HTTP SMS adapter requires SMS_HTTP_ENDPOINT and SMS_HTTP_API_KEY.',
    ];
  }
  if (
    parsed.data.OTP_SMS_PROVIDER === 'meta_whatsapp' &&
    (!parsed.data.META_WHATSAPP_TOKEN || !parsed.data.META_WHATSAPP_PHONE_NUMBER_ID)
  ) {
    productionErrors.OTP_SMS_PROVIDER = [
      'Meta WhatsApp requires META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID.',
    ];
  }
  if (
    parsed.data.WEB_PUSH_ENABLED &&
    (!parsed.data.WEB_PUSH_VAPID_PUBLIC_KEY ||
      !parsed.data.WEB_PUSH_VAPID_PRIVATE_KEY ||
      !parsed.data.WEB_PUSH_SUBJECT)
  ) {
    productionErrors.WEB_PUSH_ENABLED = [
      'WEB_PUSH_ENABLED=true requires WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_SUBJECT.',
    ];
  }
  if (parsed.data.BACKUP_PROVIDER === 'supabase') {
    if (!parsed.data.BACKUP_SUPABASE_PROJECT_REF || !parsed.data.BACKUP_SUPABASE_ACCESS_TOKEN) {
      productionErrors.BACKUP_PROVIDER = [
        'BACKUP_PROVIDER=supabase requires BACKUP_SUPABASE_PROJECT_REF and BACKUP_SUPABASE_ACCESS_TOKEN.',
      ];
    }
  }
  if (parsed.data.BACKUP_PROVIDER === 'custom_http') {
    if (!parsed.data.BACKUP_CUSTOM_BASE_URL || !parsed.data.BACKUP_CUSTOM_API_KEY) {
      productionErrors.BACKUP_PROVIDER = [
        'BACKUP_PROVIDER=custom_http requires BACKUP_CUSTOM_BASE_URL and BACKUP_CUSTOM_API_KEY.',
      ];
    }
  }
  if (parsed.data.VERIFICATION_PROVIDER === 'idenfy') {
    productionErrors.VERIFICATION_PROVIDER = [
      'Idenfy verification is not implemented for production. Use didit or manual.',
    ];
  }
  if (parsed.data.VERIFICATION_PROVIDER === 'didit') {
    if (!parsed.data.DIDIT_API_KEY) {
      productionErrors.DIDIT_API_KEY = [
        'DIDIT_API_KEY is required when VERIFICATION_PROVIDER=didit in production.',
      ];
    }
    if (!parsed.data.DIDIT_WEBHOOK_SECRET) {
      productionErrors.DIDIT_WEBHOOK_SECRET = [
        'DIDIT_WEBHOOK_SECRET is required when VERIFICATION_PROVIDER=didit in production.',
      ];
    }
    if (!parsed.data.DIDIT_WORKFLOW_ID) {
      productionErrors.DIDIT_WORKFLOW_ID = [
        'DIDIT_WORKFLOW_ID is required when VERIFICATION_PROVIDER=didit in production.',
      ];
    }
  }
  if (!parsed.data.SUPABASE_URL || !parsed.data.SUPABASE_SERVICE_ROLE_KEY) {
    productionErrors.SUPABASE_URL = [
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production so uploads are not stored on ephemeral disk.',
    ];
  }
  if (parsed.data.RETENTION_UPLOADS_DAYS > 0) {
    productionErrors.RETENTION_UPLOADS_DAYS = [
      'RETENTION_UPLOADS_DAYS is not a safe production cleanup path. Use category-specific retention settings for private uploads, need references, and bid attachments.',
    ];
  }
  // NOWPayments live checks only apply once the API key is actually configured.
  // NOWPAYMENTS_LIVE_REQUIRED=true without a key is treated as "not yet configured" — no hard-fail.
  if (parsed.data.NOWPAYMENTS_LIVE_REQUIRED && parsed.data.NOWPAYMENTS_API_KEY) {
    if (!parsed.data.NOWPAYMENTS_IPN_SECRET) {
      productionErrors.NOWPAYMENTS_IPN_SECRET = [
        'NOWPayments IPN secret is required so deposits and payouts cannot be spoofed.',
      ];
    }
    if (!parsed.data.API_PUBLIC_URL) {
      productionErrors.API_PUBLIC_URL = [
        'API_PUBLIC_URL is required for NOWPayments IPN callback URLs.',
      ];
    }
    if (!parsed.data.WEB_PUBLIC_URL) {
      productionErrors.WEB_PUBLIC_URL = [
        'WEB_PUBLIC_URL is required for trusted checkout return URLs.',
      ];
    }
  }
  // If the key is configured but LIVE_REQUIRED is off, still enforce IPN secret (security baseline).
  if (parsed.data.NOWPAYMENTS_API_KEY && !parsed.data.NOWPAYMENTS_LIVE_REQUIRED) {
    if (!parsed.data.NOWPAYMENTS_IPN_SECRET) {
      productionErrors.NOWPAYMENTS_IPN_SECRET = [
        'NOWPayments API key is set but IPN secret is missing — deposit callbacks cannot be verified.',
      ];
    }
  }
  if (parsed.data.NOWPAYMENTS_WITHDRAWALS_ENABLED || parsed.data.NOWPAYMENTS_MASS_PAYOUTS_ENABLED) {
    if (
      !parsed.data.NOWPAYMENTS_WITHDRAWALS_ENABLED ||
      !parsed.data.NOWPAYMENTS_MASS_PAYOUTS_ENABLED
    ) {
      productionErrors.NOWPAYMENTS_WITHDRAWALS_ENABLED = [
        'NOWPayments crypto withdrawals require both NOWPAYMENTS_WITHDRAWALS_ENABLED=true and NOWPAYMENTS_MASS_PAYOUTS_ENABLED=true.',
      ];
    }
    if (!parsed.data.NOWPAYMENTS_API_KEY) {
      productionErrors.NOWPAYMENTS_API_KEY = [
        'NOWPayments API key is required for crypto withdrawals.',
      ];
    }
    if (!parsed.data.NOWPAYMENTS_AUTH_EMAIL || !parsed.data.NOWPAYMENTS_AUTH_PASSWORD) {
      productionErrors.NOWPAYMENTS_AUTH_EMAIL = [
        'NOWPayments auth email/password are required for mass-payout withdrawals.',
      ];
    }
    if (parsed.data.NOWPAYMENTS_MANUAL_PAYOUT_VERIFY) {
      productionErrors.NOWPAYMENTS_MANUAL_PAYOUT_VERIFY = [
        'Crypto withdrawals are configured for automatic launch and must not require manual NOWPayments verification codes.',
      ];
    }
  }
  if (parsed.data.PAYMOB_PAYOUT_BASE_URL?.includes('staging')) {
    productionErrors.PAYMOB_PAYOUT_BASE_URL = [
      'Paymob production withdrawals must not use a staging payout endpoint.',
    ];
  }
  if (Object.keys(productionErrors).length > 0) {
    console.error('Invalid production provider configuration', productionErrors);
    throw new Error('Production provider configuration failed');
  }
}

export const env = parsed.data;
