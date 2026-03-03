// ---------------------------------------------------------------------------
// OTP validation schemas
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const sendOtpSchema = z.object({
  channel: z.enum(['email', 'phone']),
});

export const verifyOtpSchema = z.object({
  channel: z.enum(['email', 'phone']),
  code: z
    .string()
    .length(6, 'Code must be exactly 6 digits.')
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits.'),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
