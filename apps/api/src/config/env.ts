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

  // Auth / JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.coerce.number().int().positive().default(900), // 15 min
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30), // 30 days

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

  // Agora RTC
  AGORA_APP_ID: z.string().optional(),
  AGORA_APP_CERTIFICATE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;
