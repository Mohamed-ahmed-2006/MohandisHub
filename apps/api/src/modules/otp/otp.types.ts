// ---------------------------------------------------------------------------
// OTP module — internal types
// ---------------------------------------------------------------------------

import type { OtpChannel } from '@mohandishub/shared';

/** Row from the `verification_codes` table. */
export type VerificationCodeRow = {
  id: string;
  user_id: string;
  channel: OtpChannel;
  destination: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  verified_at: Date | null;
  expires_at: Date;
  created_at: Date;
};

/** Row from the `otp_rate_limits` table. */
export type OtpRateLimitRow = {
  id: string;
  user_id: string;
  channel: OtpChannel;
  sent_count: number;
  window_start: Date;
};
