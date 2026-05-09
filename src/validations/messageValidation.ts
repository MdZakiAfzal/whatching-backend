import { z } from 'zod';

const componentSchema = z.record(z.string(), z.unknown());

export const sendTemplateMessageSchema = z.object({
  body: z.object({
    phoneNumber: z.string().trim().min(6, 'A valid WhatsApp number is required'),
    templateName: z.string().trim().min(1, 'Template name is required'),
    languageCode: z.string().trim().min(2).default('en_US').optional(),
    components: z.array(componentSchema).default([]).optional(),
  }),
});

export const messageParamsSchema = z.object({
  params: z.object({
    messageId: z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid message ID is required'),
  }),
});
