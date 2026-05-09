import { z } from 'zod';

const componentSchema = z.record(z.string(), z.unknown());

export const createTemplateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Template name is required'),
    language: z.string().trim().min(2, 'Template language is required'),
    category: z.string().trim().min(1, 'Template category is required'),
    components: z.array(componentSchema).min(1, 'At least one component is required'),
    allowCategoryChange: z.boolean().optional(),
  }),
});

export const templateParamsSchema = z.object({
  params: z.object({
    templateId: z.string().trim().min(1, 'Template ID is required'),
  }),
});
