// ---------------------------------------------------------------------------
// App settings types — shared between API and frontend
// ---------------------------------------------------------------------------

/** Hrefs the admin can hide from the in-app sidebar (must match AppSidebar items). */
export const MANAGED_SIDEBAR_HREFS = [
  '/app',
  '/app/bookings',
  '/app/disputes',
  '/app/services',
  '/app/negotiations',
  '/app/advertisements',
  '/app/calendar',
  '/app/settings',
  '/app/chat',
  '/app/history',
  '/app/support',
  '/app/plan',
  '/app/admin',
] as const;

export type ManagedSidebarHref = (typeof MANAGED_SIDEBAR_HREFS)[number];

/** Built-in wallet payment method toggles; extra keys may exist for future providers. */
export const KNOWN_PAYMENT_METHOD_KEYS = [
  'deposit_crypto',
  'deposit_card',
  'deposit_instapay',
  'deposit_paymob',
  'withdrawal_crypto',
  'withdrawal_instapay',
  'withdrawal_paymob',
] as const;

export type KnownPaymentMethodKey = (typeof KNOWN_PAYMENT_METHOD_KEYS)[number];
export type PaymentMethodFlow = 'deposit' | 'withdrawal';
export type WithdrawalLimitMethod = 'crypto' | 'instapay' | 'paymob';

export type WithdrawalMethodLimit = {
  minAmountEgp: number;
  maxAmountEgp: number | null;
  dailyMaxAmountEgp: number | null;
};

export type WithdrawalLimitsConfig = Record<WithdrawalLimitMethod, WithdrawalMethodLimit>;

export const DEFAULT_WITHDRAWAL_METHOD_LIMIT: WithdrawalMethodLimit = {
  minAmountEgp: 20,
  maxAmountEgp: 10000,
  dailyMaxAmountEgp: 20000,
};

export function getDefaultWithdrawalLimits(): WithdrawalLimitsConfig {
  return {
    crypto: { ...DEFAULT_WITHDRAWAL_METHOD_LIMIT },
    instapay: { ...DEFAULT_WITHDRAWAL_METHOD_LIMIT },
    paymob: { ...DEFAULT_WITHDRAWAL_METHOD_LIMIT },
  };
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export type PaymentMethodDefinition = {
  key: KnownPaymentMethodKey;
  flow: PaymentMethodFlow;
  provider: 'nowpayments' | 'instapay_manual' | 'paymob';
  defaultEnabled: boolean;
  launchRecommended: boolean;
};

/**
 * Built-in payment rails for launch. Add future providers here first, then wire
 * their API/client flow under the same `paymentMethodsEnabled` map.
 */
export const PAYMENT_METHOD_DEFINITIONS: readonly PaymentMethodDefinition[] = [
  {
    key: 'deposit_crypto',
    flow: 'deposit',
    provider: 'nowpayments',
    defaultEnabled: true,
    launchRecommended: true,
  },
  {
    key: 'deposit_card',
    flow: 'deposit',
    provider: 'nowpayments',
    defaultEnabled: false,
    launchRecommended: false,
  },
  {
    key: 'deposit_instapay',
    flow: 'deposit',
    provider: 'instapay_manual',
    defaultEnabled: true,
    launchRecommended: true,
  },
  {
    key: 'deposit_paymob',
    flow: 'deposit',
    provider: 'paymob',
    defaultEnabled: false,
    launchRecommended: false,
  },
  {
    key: 'withdrawal_crypto',
    flow: 'withdrawal',
    provider: 'nowpayments',
    defaultEnabled: true,
    launchRecommended: true,
  },
  {
    key: 'withdrawal_instapay',
    flow: 'withdrawal',
    provider: 'instapay_manual',
    defaultEnabled: true,
    launchRecommended: true,
  },
  {
    key: 'withdrawal_paymob',
    flow: 'withdrawal',
    provider: 'paymob',
    defaultEnabled: false,
    launchRecommended: false,
  },
] as const;

export function getDefaultPaymentMethodsEnabled(): Record<KnownPaymentMethodKey, boolean> {
  return Object.fromEntries(
    PAYMENT_METHOD_DEFINITIONS.map((method) => [method.key, method.defaultEnabled]),
  ) as Record<KnownPaymentMethodKey, boolean>;
}

/**
 * Merge stored JSON with legacy disable_* columns. Unknown keys in `raw` are preserved
 * so future methods can be toggled without a migration.
 */
export function parsePaymentMethodsEnabled(
  raw: unknown,
  legacy: { disableCryptoDeposits: boolean; disableCardDeposits: boolean },
): Record<string, boolean> {
  const base: Record<string, boolean> = getDefaultPaymentMethodsEnabled();
  base.deposit_crypto = !legacy.disableCryptoDeposits;
  base.deposit_card = !legacy.disableCardDeposits && base.deposit_card === true;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const out = { ...base };
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function isPaymentMethodEnabled(map: Record<string, boolean>, key: string): boolean {
  return map[key] !== false;
}

export function parseWithdrawalLimits(raw: unknown): WithdrawalLimitsConfig {
  const out = getDefaultWithdrawalLimits();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const source = raw as Record<string, unknown>;
  for (const method of Object.keys(out) as WithdrawalLimitMethod[]) {
    const candidate = source[method];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const o = candidate as Record<string, unknown>;
    const min = parsePositiveNumber(o.minAmountEgp ?? o.min_amount_egp);
    const max = parsePositiveNumber(o.maxAmountEgp ?? o.max_amount_egp);
    const daily = parsePositiveNumber(o.dailyMaxAmountEgp ?? o.daily_max_amount_egp);
    out[method] = {
      minAmountEgp: min ?? out[method].minAmountEgp,
      maxAmountEgp: max,
      dailyMaxAmountEgp: daily,
    };
  }
  return out;
}

export type AppSettings = {
  id: string;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupsLocked: boolean;
  depositsPaused: boolean;
  moneyMovementsPaused: boolean;
  updatedAt: string;
  updatedBy: string | null;
  // Phase 2
  lockLogins: boolean;
  disableCryptoDeposits: boolean;
  disableCardDeposits: boolean;
  minDepositAmount: number | null;
  maxDepositAmount: number | null;
  pausePlanSubscriptions: boolean;
  pauseNeeds: boolean;
  pauseBids: boolean;
  pauseAwardBids: boolean;
  pauseUploads: boolean;
  pauseVerificationSubmissions: boolean;
  pauseChat: boolean;
  pauseOtpEmails: boolean;
  featureNeedsEnabled: boolean;
  featurePlansEnabled: boolean;
  featureWalletEnabled: boolean;
  featureHourlyPricingEnabled: boolean;
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  /** Minimum paid transaction amount (EGP) for bids/reservations (0 = no floor). */
  minTransactionEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
  couponGenerationFeeEgp: number;
  walletEgpPerUsdtDeposit: number | null;
  walletEgpPerUsdtWithdrawal: number | null;
  platformInstapayDisplay: Record<string, unknown> | null;
  walletUsdToEgpMigrationRate: number | null;
  walletMigrationUsdToEgpApplied: boolean;
  /** Hrefs to omit from the app sidebar (e.g. ["/app/support"]). */
  sidebarHiddenHrefs: string[];
  /** Max public upload size in bytes (null = use API default). Cannot exceed server ceiling. */
  maxPublicUploadBytes: number | null;
  /** When set, public uploads must use one of these MIME types. */
  publicUploadAllowedMimes: string[] | null;
  /** Optional link to Supabase Storage dashboard for operators. */
  supabaseStorageDashboardUrl: string | null;
  /**
   * When false, the method is hidden in the wallet UI and blocked by the API.
   * Always includes {@link KNOWN_PAYMENT_METHOD_KEYS}; may include additional keys.
   */
  paymentMethodsEnabled: Record<string, boolean>;
  withdrawalLimits: WithdrawalLimitsConfig;
};

/** Public app status returned by GET /api/app/status — subset needed by frontend */
export type AppStatus = {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupsLocked: boolean;
  lockLogins: boolean;
  depositsPaused: boolean;
  moneyMovementsPaused: boolean;
  disableCryptoDeposits: boolean;
  disableCardDeposits: boolean;
  minDepositAmount: number | null;
  maxDepositAmount: number | null;
  pausePlanSubscriptions: boolean;
  pauseNeeds: boolean;
  pauseBids: boolean;
  pauseAwardBids: boolean;
  pauseUploads: boolean;
  pauseVerificationSubmissions: boolean;
  pauseChat: boolean;
  pauseOtpEmails: boolean;
  featureNeedsEnabled: boolean;
  featurePlansEnabled: boolean;
  featureWalletEnabled: boolean;
  featureHourlyPricingEnabled: boolean;
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  /** Minimum paid transaction amount (EGP) for bids/reservations (0 = no floor). */
  minTransactionEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
  couponGenerationFeeEgp: number;
  walletEgpPerUsdtDeposit: number | null;
  walletEgpPerUsdtWithdrawal: number | null;
  platformInstapayDisplay: Record<string, unknown> | null;
  walletUsdToEgpMigrationRate: number | null;
  walletMigrationUsdToEgpApplied: boolean;
  sidebarHiddenHrefs: string[];
  paymentMethodsEnabled: Record<string, boolean>;
  withdrawalLimits: WithdrawalLimitsConfig;
};

export type UpdateAppSettingsBody = Partial<{
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupsLocked: boolean;
  depositsPaused: boolean;
  moneyMovementsPaused: boolean;
  lockLogins: boolean;
  disableCryptoDeposits: boolean;
  disableCardDeposits: boolean;
  minDepositAmount: number | null;
  maxDepositAmount: number | null;
  pausePlanSubscriptions: boolean;
  pauseNeeds: boolean;
  pauseBids: boolean;
  pauseAwardBids: boolean;
  pauseUploads: boolean;
  pauseVerificationSubmissions: boolean;
  pauseChat: boolean;
  pauseOtpEmails: boolean;
  featureNeedsEnabled: boolean;
  featurePlansEnabled: boolean;
  featureWalletEnabled: boolean;
  featureHourlyPricingEnabled: boolean;
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  minTransactionEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
  couponGenerationFeeEgp: number;
  walletEgpPerUsdtDeposit: number | null;
  walletEgpPerUsdtWithdrawal: number | null;
  platformInstapayDisplay: Record<string, unknown> | null;
  walletUsdToEgpMigrationRate: number | null;
  sidebarHiddenHrefs: string[];
  maxPublicUploadBytes: number | null;
  publicUploadAllowedMimes: string[] | null;
  supabaseStorageDashboardUrl: string | null;
  /** Merged into stored flags; omit keys you do not change. */
  paymentMethodsEnabled?: Record<string, boolean>;
  withdrawalLimits?: Partial<Record<WithdrawalLimitMethod, Partial<WithdrawalMethodLimit>>>;
}>;
