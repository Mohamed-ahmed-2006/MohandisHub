export const RETENTION_CATEGORY_KEYS = [
  'verificationCodesAfterExpiry',
  'otpRateLimitWindows',
  'refreshTokensAfterExpiry',
  'verificationRequestsTerminal',
  'dmMessages',
  'needReferenceAfterCompleted',
  'bidMessageAttachments',
  'verifiedPrivateUploads',
  'unverifiedAccounts',
] as const;

export type RetentionCategoryKey = (typeof RETENTION_CATEGORY_KEYS)[number];

export type RetentionCategoryConfig = {
  enabled: boolean;
  unit: 'hours' | 'days';
  /** Must be > 0 when enabled */
  value: number;
};

export type RetentionPolicyJson = {
  masterEnabled?: boolean;
  /** When true, the next scheduled worker sweep runs as dry-run then clears this flag */
  dryRunNextScheduled?: boolean;
  categories?: Partial<Record<RetentionCategoryKey, RetentionCategoryConfig>>;
};

export type RetentionAlertsJson = {
  webhookUrl?: string | null;
  alertEmail?: string | null;
  /** When deletes in a category exceed this in one sweep, send alert */
  deleteCountThresholds?: Partial<Record<RetentionCategoryKey, number>>;
};

export type SweepStepResult = {
  deletedRows?: number;
  deletedFiles?: number;
  skipped?: boolean;
  reason?: string;
};

export type SweepResults = Record<string, SweepStepResult>;
