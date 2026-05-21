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

export const templateDraftParamsSchema = z.object({
  params: z.object({
    draftId: z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid draft ID is required'),
  }),
});

export const createTemplateDraftSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Template name is required'),
    language: z.string().trim().min(2, 'Template language is required'),
    category: z.string().trim().min(1, 'Template category is required'),
    components: z.array(componentSchema).min(1, 'At least one component is required'),
    allowCategoryChange: z.boolean().optional(),
  }),
});

export const updateTemplateDraftSchema = z.object({
  params: z.object({
    draftId: z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid draft ID is required'),
  }),
  body: z.object({
    name: z.string().trim().min(1).optional(),
    language: z.string().trim().min(2).optional(),
    category: z.string().trim().min(1).optional(),
    components: z.array(componentSchema).min(1).optional(),
    allowCategoryChange: z.boolean().optional(),
  }),
});

export const submitTemplateDraftSchema = z.object({
  params: z.object({
    draftId: z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid draft ID is required'),
  }),
});

export const editTemplateSchema = z.object({
  params: z.object({
    templateId: z.string().trim().regex(/^[a-f\d]{24}$/i, 'A valid ID is required'),
  }),
  body: z.object({
    components: z.array(z.record(z.string(), z.unknown())).min(1, 'At least one component is required for the edit'),
  }),
});