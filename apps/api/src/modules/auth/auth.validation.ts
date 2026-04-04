// ---------------------------------------------------------------------------
// Auth validation schemas — Zod schemas for request bodies
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const registerSchema = z
  .object({
    email: z.string().email('Invalid email format.').max(255),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(128, 'Password must not exceed 128 characters.')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter.')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter.')
      .regex(/[0-9]/, 'Password must contain at least one digit.'),
    displayName: z
      .string()
      .min(2, 'Display name must be at least 2 characters.')
      .max(100, 'Display name must not exceed 100 characters.')
      .trim(),
    role: z.enum(['customer', 'expert', 'business', 'craftsman']),
    phone: z.string().max(20).optional(),
    phoneCode: z.string().max(6).optional(),
    nationality: z.string().max(3).optional(),
    companyName: z
      .string()
      .min(2, 'Company name must be at least 2 characters.')
      .max(200)
      .optional(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format.')
      .refine(
        (val) => {
          const dob = new Date(val);
          const today = new Date();
          const age = today.getFullYear() - dob.getFullYear();
          const monthDiff = today.getMonth() - dob.getMonth();
          const dayDiff = today.getDate() - dob.getDate();
          const actualAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;
          return actualAge >= 20;
        },
        { message: 'You must be at least 20 years old to register.' },
      ),
    acceptedTermsAt: z.string().min(1, 'Accepted terms timestamp is required.').optional(),
    termsVersion: z.string().max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'business') {
      if (!data.companyName || data.companyName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['companyName'],
          message: 'Company name is required for business accounts.',
        });
      }
      if (!data.phone || data.phone.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phone'],
          message: 'Phone number is required for business accounts.',
        });
      }
    }
    if (!data.acceptedTermsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['acceptedTermsAt'],
        message: 'You must accept the Terms and Conditions.',
      });
    }
  });

export const loginSchema = z.object({
  email: z.string().email('Invalid email format.'),
  password: z.string().min(1, 'Password is required.'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format.'),
});

const resetPasswordPasswordField = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must not exceed 128 characters.')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must contain at least one digit.');

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required.'),
  password: resetPasswordPasswordField,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
