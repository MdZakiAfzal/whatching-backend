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
    if (typeof content.bodyText !== 'string' || content.bodyText.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Generic carousel blocks require main bodyText.',
        path: ['content', 'bodyText'],
      });
    }

    if (!Array.isArray(content.cards) || content.cards.length < 2 || content.cards.length > 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Generic carousel blocks require between 2 and 10 cards.',
        path: ['content', 'cards'],
      });
      return;
    }

    const firstCardButtons = Array.isArray((content.cards[0] as any)?.buttons)
      ? (content.cards[0] as any).buttons
      : [];
    const firstButtonTypes = firstCardButtons.map((button: any) =>
      String(button?.type || (button?.url ? 'url' : 'quick_reply'))
    );

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

      const mediaType = String(card.mediaType || '').toLowerCase();
      if (!['image', 'video'].includes(mediaType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} mediaType must be image or video.`,
          path: ['content', 'cards', index, 'mediaType'],
        });
      }

      if (typeof card.mediaUrl !== 'string' || card.mediaUrl.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} requires mediaUrl.`,
          path: ['content', 'cards', index, 'mediaUrl'],
        });
      }

      if (typeof card.bodyText === 'string' && card.bodyText.length > 160) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} bodyText must be 160 characters or fewer.`,
          path: ['content', 'cards', index, 'bodyText'],
        });
      }

      if (typeof card.bodyText === 'string' && (card.bodyText.match(/\n/g) || []).length > 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} bodyText can include at most 2 line breaks.`,
          path: ['content', 'cards', index, 'bodyText'],
        });
      }

      if (Array.isArray(card.buttons)) {
        const buttonTypes = card.buttons.map((button: any) =>
          String(button?.type || (button?.url ? 'url' : 'quick_reply'))
        );

        if (
          buttonTypes.length !== firstButtonTypes.length ||
          buttonTypes.some((buttonType: string, buttonIndex: number) => buttonType !== firstButtonTypes[buttonIndex])
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Carousel button types and counts must match across all cards.',
            path: ['content', 'cards', index, 'buttons'],
          });
        }
      }

      if (!Array.isArray(card.buttons) || card.buttons.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Carousel card ${index + 1} requires at least one reply button.`,
          path: ['content', 'cards', index, 'buttons'],
        });
        return;
      }

      card.buttons.forEach((button: any, buttonIndex: number) => {
        if (!button || typeof button !== 'object') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Carousel card ${index + 1} button ${buttonIndex + 1} is invalid.`,
            path: ['content', 'cards', index, 'buttons', buttonIndex],
          });
          return;
        }

        if (typeof button.label !== 'string' || button.label.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Carousel card ${index + 1} button ${buttonIndex + 1} requires label.`,
            path: ['content', 'cards', index, 'buttons', buttonIndex, 'label'],
          });
        }

        const buttonType = button.type || (button.url ? 'url' : 'quick_reply');
        if (!['quick_reply', 'url'].includes(buttonType)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Carousel card ${index + 1} button ${buttonIndex + 1} type must be quick_reply or url.`,
            path: ['content', 'cards', index, 'buttons', buttonIndex, 'type'],
          });
        }

        if (buttonType === 'quick_reply' && typeof button.replyId !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Carousel card ${index + 1} quick reply button ${buttonIndex + 1} requires replyId.`,
            path: ['content', 'cards', index, 'buttons', buttonIndex, 'replyId'],
          });
        }

        if (buttonType === 'url' && typeof button.url !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Carousel card ${index + 1} URL button ${buttonIndex + 1} requires url.`,
            path: ['content', 'cards', index, 'buttons', buttonIndex, 'url'],
          });
        }
      });
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
});

const createFlowBodySchema = baseFlowSchema.superRefine((value, ctx) => {
  validateFlowContentStructure(value.blockType, value.content, ctx);
});

const updateFlowBodySchema = baseFlowSchema.partial().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one field must be provided to update the flow.',
    });
    return;
  }

  if (value.blockType && value.content) {
    validateFlowContentStructure(value.blockType, value.content, ctx);
  }
});

export const botFlowParamsSchema = z.object({
  params: z.object({
    flowId: objectIdSchema,
  }),
});

export const createBotFlowSchema = z.object({
  body: createFlowBodySchema,
});

export const updateBotFlowSchema = z.object({
  params: z.object({
    flowId: objectIdSchema,
  }),
  body: updateFlowBodySchema,
});

export const publishBotCanvasSchema = z.object({
  body: z.union([
    z.object({
      flows: z.array(createFlowBodySchema).min(1).max(500),
    }),
    z.array(createFlowBodySchema).min(1).max(500),
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
