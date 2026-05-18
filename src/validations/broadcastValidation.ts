import { z } from 'zod';

const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid ID is required');
const isoDateStringSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'A valid ISO date is required');
const dynamicValueSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('literal'),
    text: z.string().trim().min(1, 'Literal text is required'),
  }),
  z.object({
    source: z.literal('subscriber_field'),
    path: z.enum(['firstName', 'lastName', 'fullName', 'phoneNumber', 'waId']),
    fallback: z.string().trim().optional(),
  }),
  z.object({
    source: z.literal('metadata_field'),
    path: z.string().trim().min(1, 'Metadata path is required'),
    fallback: z.string().trim().optional(),
  }),
]);

const componentParameterSchema = z
  .object({
    type: z.string().trim().min(1, 'Parameter type is required'),
    text: z.string().trim().optional(),
    value: dynamicValueSchema.optional(),
    image: z.record(z.string(), z.unknown()).optional(),
    document: z.record(z.string(), z.unknown()).optional(),
    video: z.record(z.string(), z.unknown()).optional(),
    currency: z.record(z.string(), z.unknown()).optional(),
    date_time: z.record(z.string(), z.unknown()).optional(),
    payload: z.string().trim().optional(),
  })
  .passthrough();

const componentSchema = z
  .object({
    type: z.string().trim().min(1, 'Component type is required'),
    sub_type: z.string().trim().optional(),
    index: z.string().trim().optional(),
    parameters: z.array(componentParameterSchema).optional(),
  })
  .passthrough();

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
  body: z
    .object({
      scheduledAt: isoDateStringSchema.optional(),
      scheduledLocal: z.string().trim().optional(),
      timezone: z.string().trim().optional(),
    })
    .default({}),
});

export const cancelBroadcastSchema = z.object({
  params: z.object({
    broadcastId: objectIdSchema,
  }),
});
