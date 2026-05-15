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
    text: z.string().trim().min(1, 'Reply text is required').max(4096, 'Reply text is too long'),
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
