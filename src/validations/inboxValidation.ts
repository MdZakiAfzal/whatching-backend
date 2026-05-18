import { z } from 'zod';

const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid ID is required');

export const conversationParamsSchema = z.object({
  params: z.object({
    conversationId: objectIdSchema,
  }),
});

export const subscriberParamsSchema = z.object({
  params: z.object({
    subscriberId: objectIdSchema,
  }),
});

export const assignConversationSchema = z.object({
  params: z.object({
    conversationId: objectIdSchema,
  }),
  body: z.object({
    assignedToUserId: objectIdSchema.nullable(),
  }),
});

export const updateConversationStatusSchema = z.object({
  params: z.object({
    conversationId: objectIdSchema,
  }),
  body: z.object({
    status: z.enum(['open', 'pending', 'resolved']),
  }),
});

export const replyToConversationSchema = z.object({
  params: z.object({
    conversationId: objectIdSchema,
  }),
  body: z.object({
    messageType: z.enum(['text', 'image', 'document', 'audio', 'video']).optional(),
    text: z.string().trim().max(4096, 'Reply text is too long').optional(),
    caption: z.string().trim().max(1024, 'Caption is too long').optional(),
  }),
});

export const markConversationReadSchema = z.object({
  params: z.object({
    conversationId: objectIdSchema,
  }),
});

export const updateSubscriberSchema = z.object({
  params: z.object({
    subscriberId: objectIdSchema,
  }),
  body: z.object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    isOptedIn: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const updateSubscriberTagsSchema = z.object({
  params: z.object({
    subscriberId: objectIdSchema,
  }),
  body: z.object({
    tags: z.array(z.string().trim().min(1)).max(50),
  }),
});

const importSubscriberRowSchema = z.object({
  phoneNumber: z.string().trim().min(6, 'A valid WhatsApp number is required'),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  isOptedIn: z.boolean().optional(),
  optInSource: z.string().trim().min(1).optional(),
});

export const importSubscribersSchema = z.object({
  body: z.union([
    z.object({
      subscribers: z.array(importSubscriberRowSchema).min(1).max(10000),
      dryRun: z.boolean().optional(),
    }),
    z.array(importSubscriberRowSchema).min(1).max(10000),
  ]),
});
