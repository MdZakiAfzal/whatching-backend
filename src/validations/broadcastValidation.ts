import { z } from 'zod';

const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid ID is required');
const isoDateStringSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'A valid ISO date is required');
const componentSchema = z.record(z.string(), z.unknown());

const audienceSchema = z
  .discriminatedUnion('mode', [
    z.object({
      mode: z.literal('all'),
      optedInOnly: z.boolean().default(true).optional(),
    }),
    z.object({
      mode: z.literal('tags'),
      tags: z.array(z.string().trim().min(1, 'A valid tag is required')).min(1, 'At least one tag is required'),
      tagMatch: z.enum(['any', 'all']).default('any').optional(),
      optedInOnly: z.boolean().default(true).optional(),
    }),
    z.object({
      mode: z.literal('specific'),
      subscriberIds: z.array(objectIdSchema).min(1, 'At least one subscriber is required'),
      optedInOnly: z.boolean().default(true).optional(),
    }),
  ])
  .transform((audience) => ({
    ...audience,
    optedInOnly: audience.optedInOnly ?? true,
  }));

export const createBroadcastSchema = z.object({
  body: z.object({
    name: z.string().trim().min(3, 'Broadcast name must be at least 3 characters').max(120),
    templateId: z.string().trim().min(1, 'Template ID is required'),
    components: z.array(componentSchema).default([]).optional(),
    audience: audienceSchema,
  }),
});

export const listBroadcastsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z
      .enum(['draft', 'scheduled', 'processing', 'in_progress', 'completed', 'canceled', 'failed'])
      .optional(),
    q: z.string().trim().optional(),
  }),
});

export const broadcastParamsSchema = z.object({
  params: z.object({
    broadcastId: objectIdSchema,
  }),
});

export const getBroadcastSchema = z.object({
  params: z.object({
    broadcastId: objectIdSchema,
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    recipientStatus: z
      .enum(['pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'canceled'])
      .optional(),
  }),
});

export const startBroadcastSchema = z.object({
  params: z.object({
    broadcastId: objectIdSchema,
  }),
  body: z.object({
    scheduledAt: isoDateStringSchema.optional(),
  }),
});

export const cancelBroadcastSchema = z.object({
  params: z.object({
    broadcastId: objectIdSchema,
  }),
});
