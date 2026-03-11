import { z } from 'zod';

const messageTypeEnum = z.enum(['text', 'image', 'voice', 'link', 'location']);

export const sendMessageSchema = z
  .object({
    body: z.string().max(64_000).optional(),
    replyToId: z.string().uuid().optional(),
    messageType: messageTypeEnum.optional().default('text'),
    attachmentUrl: z.string().url().max(2_000).optional(),
    linkUrl: z.string().url().max(2_000).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    label: z.string().max(500).optional(),
  })
  .refine(
    (data) => {
      switch (data.messageType) {
        case 'link':
          return !!data.linkUrl?.trim();
        case 'location':
          return data.lat != null && data.lng != null;
        case 'text':
          return ((data.body ?? '').trim().length > 0) || !!data.attachmentUrl;
        case 'image':
        case 'voice':
          return ((data.body ?? '').trim().length > 0) || !!data.attachmentUrl;
        default:
          return true;
      }
    },
    { message: 'Link requires linkUrl; location requires lat/lng; text/image/voice requires body or attachmentUrl.' },
  );

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const deleteMessageSchema = z.object({
  scope: z.enum(['for_me', 'for_everyone']),
});

export type DeleteMessageInput = z.infer<typeof deleteMessageSchema>;
