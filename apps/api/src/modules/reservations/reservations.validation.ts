import { z } from 'zod';

export const upsertReservationProfileSchema = z.object({
  autoAccept: z.boolean().optional(),
  onlineVoicePrice: z.number().min(0).max(1000000).optional(),
  onlineVideoPrice: z.number().min(0).max(1000000).optional(),
  offlinePrice: z.number().min(0).max(1000000).optional(),
  currency: z.string().max(10).optional(),
});

export const createReservationSlotSchema = z
  .object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    supportsOnline: z.boolean().optional(),
    supportsOffline: z.boolean().optional(),
  })
  .refine((d) => new Date(d.endAt) > new Date(d.startAt), {
    message: 'endAt must be after startAt',
  });

export const updateReservationSlotSchema = z.object({
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  status: z.enum(['available', 'booked', 'blocked']).optional(),
  supportsOnline: z.boolean().optional(),
  supportsOffline: z.boolean().optional(),
});

export const createReservationSchema = z.object({
  serviceId: z.string().uuid().optional(),
  providerId: z.string().uuid(),
  slotId: z.string().uuid(),
  mode: z.enum(['online', 'offline']),
  onlineType: z.enum(['voice', 'video']).optional(),
}).superRefine((v, ctx) => {
  if (v.mode === 'online' && !v.onlineType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'onlineType is required for online reservations',
      path: ['onlineType'],
    });
  }

  if (v.mode === 'offline' && v.onlineType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'onlineType is not allowed for offline reservations',
      path: ['onlineType'],
    });
  }
});

export const decideReservationSchema = z
  .object({
    decision: z.enum(['accept', 'reject']),
    rejectionReason: z.string().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && !v.rejectionReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rejectionReason is required for reject decision',
        path: ['rejectionReason'],
      });
    }
  });

export const proposeLocationSchema = z.object({
  locationText: z.string().min(2).max(500),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const respondLocationSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(['accept', 'reject']),
});

export const confirmCheckinSchema = z.object({
  counterpartyCode: z.string().min(3).max(12),
});

export const finishReservationSchema = z.object({
  action: z.enum(['done', 'report']),
  reportReason: z.string().max(2000).optional(),
});

export const callJoinSchema = z.object({
  mediaType: z.enum(['voice', 'video']),
});

export const callHeartbeatSchema = z.object({
  connected: z.boolean(),
});

export const callExtensionSchema = z.object({
  decision: z.enum(['request', 'approve', 'reject']),
});

export const endCallSchema = z.object({
  action: z.enum(['end', 'refresh']),
});

export const resolveDisputeSchema = z.object({
  status: z.enum([
    'resolved_customer',
    'resolved_provider',
    'resolved_partial',
    'dismissed',
  ]),
  resolutionNotes: z.string().max(4000).optional(),
});

export type UpsertReservationProfileInput = z.infer<typeof upsertReservationProfileSchema>;
export type CreateReservationSlotInput = z.infer<typeof createReservationSlotSchema>;
export type UpdateReservationSlotInput = z.infer<typeof updateReservationSlotSchema>;
export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type DecideReservationInput = z.infer<typeof decideReservationSchema>;
export type ProposeLocationInput = z.infer<typeof proposeLocationSchema>;
export type RespondLocationInput = z.infer<typeof respondLocationSchema>;
export type ConfirmCheckinInput = z.infer<typeof confirmCheckinSchema>;
export type FinishReservationInput = z.infer<typeof finishReservationSchema>;
export type CallJoinInput = z.infer<typeof callJoinSchema>;
export type CallHeartbeatInput = z.infer<typeof callHeartbeatSchema>;
export type CallExtensionInput = z.infer<typeof callExtensionSchema>;
export type EndCallInput = z.infer<typeof endCallSchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
