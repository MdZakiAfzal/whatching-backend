import { z } from 'zod';

const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid ID is required');

const flowActionSchema = z.object({
  actionId: z.string().trim().min(1),
  type: z.enum(['go_to_trigger', 'escalate_to_agent', 'end_conversation', 'open_url']),
  label: z.string().trim().optional(),
  replyId: z.string().trim().optional(),
  nextTriggerKey: z.string().trim().optional(),
  url: z.string().trim().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const botFlowBlockTypeSchema = z.enum([
  'text',
  'buttons',
  'list',
  'image',
  'document',
  'location',
  'product_carousel',
  'generic_carousel',
]);

const validateFlowContentStructure = (
  blockType: z.infer<typeof botFlowBlockTypeSchema>,
  content: Record<string, unknown>,
  ctx: z.RefinementCtx
) => {
  if (blockType === 'buttons') {
    if (typeof content.bodyText !== 'string' || content.bodyText.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Button bot blocks require bodyText.',
        path: ['content', 'bodyText'],
      });
    }

    if (content.mediaType) {
      const mediaType = String(content.mediaType).toLowerCase();
      if (!['image', 'document', 'video'].includes(mediaType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Button mediaType must be image, document, or video.',
          path: ['content', 'mediaType'],
        });
      }
      if (typeof content.mediaUrl !== 'string' || content.mediaUrl.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Button media headers require mediaUrl when mediaType is provided.',
          path: ['content', 'mediaUrl'],
        });
      }
    }
  }

  if (blockType === 'generic_carousel') {
    if (!Array.isArray(content.cards) || content.cards.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Generic carousel blocks require at least one card.',
        path: ['content', 'cards'],
      });
      return;
    }

    content.cards.forEach((card: any, index: number) => {
      if (!card || typeof card !== 'object') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} is invalid.`,
          path: ['content', 'cards', index],
        });
        return;
      }

      if (typeof card.bodyText !== 'string' || card.bodyText.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} requires bodyText.`,
          path: ['content', 'cards', index, 'bodyText'],
        });
      }

      if (card.mediaType) {
        const mediaType = String(card.mediaType).toLowerCase();
        if (!['image', 'document', 'video'].includes(mediaType)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Carousel card ${index + 1} mediaType must be image, document, or video.`,
            path: ['content', 'cards', index, 'mediaType'],
          });
        }
        if (typeof card.mediaUrl !== 'string' || card.mediaUrl.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Carousel card ${index + 1} requires mediaUrl when mediaType is provided.`,
            path: ['content', 'cards', index, 'mediaUrl'],
          });
        }
      }

      if (!Array.isArray(card.buttons) || card.buttons.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} requires at least one reply button.`,
          path: ['content', 'cards', index, 'buttons'],
        });
      }
    });
  }
};

const baseFlowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  triggerKey: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
  blockType: botFlowBlockTypeSchema,
  sortOrder: z.number().int().min(0).default(0),
  content: z.record(z.string(), z.unknown()),
  actions: z.array(flowActionSchema).max(20).default([]),
}).superRefine((value, ctx) => {
  validateFlowContentStructure(value.blockType, value.content, ctx);
});

export const botFlowParamsSchema = z.object({
  params: z.object({
    flowId: objectIdSchema,
  }),
});

export const createBotFlowSchema = z.object({
  body: baseFlowSchema,
});

export const updateBotFlowSchema = z.object({
  params: z.object({
    flowId: objectIdSchema,
  }),
  body: baseFlowSchema.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided to update the flow.',
  }),
});

export const publishBotCanvasSchema = z.object({
  body: z.union([
    z.object({
      flows: z.array(baseFlowSchema).min(1).max(500),
    }),
    z.array(baseFlowSchema).min(1).max(500),
  ]),
});

export const patchBotSettingsSchema = z.object({
  body: z.object({
    isBotEnabled: z.boolean().optional(),
    isAiEnabled: z.boolean().optional(),
    systemPrompt: z.string().trim().max(12000).optional(),
    defaultTriggerKey: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()).optional(),
    greetingKeywords: z.array(z.string().trim().min(1)).max(50).optional(),
    optOutKeywords: z.array(z.string().trim().min(1)).max(50).optional(),
    escalationTriggerIds: z.array(z.string().trim().min(1)).max(100).optional(),
    autoTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
    geminiModel: z.string().trim().min(1).max(120).optional(),
  }),
});

export const createKnowledgeTextSchema = z.object({
  body: z.object({
    type: z.enum(['text', 'faq']).default('text'),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().max(50000).optional(),
    faqEntries: z
      .array(
        z.object({
          question: z.string().trim().min(1).max(2000),
          answer: z.string().trim().min(1).max(8000),
        })
      )
      .max(200)
      .optional(),
  }),
});

export const knowledgeSourceParamsSchema = z.object({
  params: z.object({
    sourceId: objectIdSchema,
  }),
});
