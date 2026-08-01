import { z } from 'zod';

// ---------------------------------------------------------------------------
// Provider direct-payment methods — method-specific validation
// ---------------------------------------------------------------------------
// Under the launch model the customer pays the provider DIRECTLY, so these
// details are the only route by which money reaches a provider. `details` is a
// JSONB column with no database-level shape, and decision D5 requires a
// method-specific schema rather than arbitrary JSON: unvalidated free text here
// is a phishing vector, since whatever a provider types is later shown to a
// paying customer as authoritative payment instructions.
//
// FIELD CHOICE: the schema has no enumeration of these fields, so the shapes
// below are derived from what each Egyptian rail actually needs to receive a
// transfer. They are deliberately minimal — every field is something the payer
// must have. If a rail needs more, add it explicitly rather than reopening the
// object to arbitrary keys.
// ---------------------------------------------------------------------------

/** Arabic-Indic and Extended Arabic-Indic digits normalised to ASCII. */
const normalizeDigits = (input: string): string =>
  input.replace(/[٠-٩۰-۹]/g, (char) => {
    const code = char.codePointAt(0)!;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });

/** Egyptian mobile number: 11 digits starting 010/011/012/015, or +20 form. */
const egyptianPhone = z
  .string()
  .trim()
  .transform((v) => normalizeDigits(v).replace(/[\s-]/g, ''))
  .refine((v) => /^(?:\+?20)?0?1[0125]\d{8}$/.test(v), {
    message: 'Enter a valid Egyptian mobile number (e.g. 01012345678).',
  });

const accountHolder = z.string().trim().min(3, 'Enter the full account holder name.').max(120);

export const instapayDetailsSchema = z.object({
  /** InstaPay address, e.g. `name@instapay`. */
  instapayAddress: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .refine((v) => /^[A-Za-z0-9._-]+@[A-Za-z0-9.]+$/.test(v), {
      message: 'Enter a valid InstaPay address (e.g. yourname@instapay).',
    }),
  accountHolderName: accountHolder,
});

export const mobileWalletDetailsSchema = z.object({
  walletProvider: z.enum(['vodafone_cash', 'etisalat_cash', 'orange_money', 'we_pay']),
  phoneNumber: egyptianPhone,
  accountHolderName: accountHolder,
});

export const bankTransferDetailsSchema = z.object({
  bankName: z.string().trim().min(2).max(120),
  accountHolderName: accountHolder,
  // Egyptian account numbers vary by bank; IBAN is the reliable identifier, so
  // one of the two is required rather than both.
  accountNumber: z.string().trim().min(6).max(34).optional(),
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, '').toUpperCase())
    .refine((v) => /^EG\d{2}[A-Z0-9]{25}$/.test(v), {
      message: 'Enter a valid Egyptian IBAN (EG followed by 27 characters).',
    })
    .optional(),
  branch: z.string().trim().max(120).optional(),
});

export const METHOD_TYPES = ['instapay', 'mobile_wallet', 'bank_transfer'] as const;
export type ProviderPaymentMethodType = (typeof METHOD_TYPES)[number];

/**
 * Discriminated on methodType so each variant gets its own rules and unknown
 * keys are stripped rather than persisted.
 */
export const upsertPaymentMethodSchema = z
  .discriminatedUnion('methodType', [
    z.object({
      methodType: z.literal('instapay'),
      label: z.string().trim().max(120).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(100).optional(),
      details: instapayDetailsSchema,
    }),
    z.object({
      methodType: z.literal('mobile_wallet'),
      label: z.string().trim().max(120).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(100).optional(),
      details: mobileWalletDetailsSchema,
    }),
    z.object({
      methodType: z.literal('bank_transfer'),
      label: z.string().trim().max(120).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(100).optional(),
      details: bankTransferDetailsSchema,
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.methodType === 'bank_transfer' &&
      !value.details.accountNumber &&
      !value.details.iban
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide an account number or an IBAN.',
        path: ['details', 'accountNumber'],
      });
    }
  });

export type UpsertPaymentMethodInput = z.infer<typeof upsertPaymentMethodSchema>;
