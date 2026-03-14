import { z } from 'zod';

export const addFavoriteSchema = z.object({
  targetType: z.enum(['provider', 'service']),
  targetId: z.string().uuid(),
});

export type AddFavoriteInput = z.infer<typeof addFavoriteSchema>;
