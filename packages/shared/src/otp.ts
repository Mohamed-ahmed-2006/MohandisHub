// ---------------------------------------------------------------------------
// OTP shared types — used by both API and frontend
// ---------------------------------------------------------------------------

/** Which channel the OTP is sent through. */
export type OtpChannel = 'email' | 'phone';

/** Request body: send a verification code. */
export type SendOtpBody = {
  channel: OtpChannel;
};

/** Request body: verify a code. */
export type VerifyOtpBody = {
  channel: OtpChannel;
  code: string;
};

/** Response after sending a code. */
export type SendOtpResult = {
  channel: OtpChannel;
  destination: string; // masked email/phone for display
  expiresInSeconds: number;
};

/** Response after verifying a code. */
export type VerifyOtpResult = {
  channel: OtpChannel;
  verified: boolean;
};
