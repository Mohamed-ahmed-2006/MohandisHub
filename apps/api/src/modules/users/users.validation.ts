import { z } from 'zod';

export const updateAccountSchema = z.object({
  displayName: z.string().min(2).max(100).trim().optional(),
  phone: z.string().max(20).nullable().optional(),
  phoneCode: z.string().max(6).nullable().optional(),
  nationality: z.string().max(3).nullable().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format.')
    .nullable()
    .optional(),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const requestEmailChangeSchema = z.object({
  newEmail: z.string().email('Invalid email format.').max(255),
});

export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;

export const confirmEmailChangeSchema = z.object({
  code: z.string().min(6).max(6),
});

export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;
