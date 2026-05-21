import { z } from 'zod';

const objectIdRegex = /^[a-f\d]{24}$/i;

export const mediaParamsSchema = z.object({
  params: z.object({
    mediaId: z.string().trim().regex(objectIdRegex, 'A valid Media ID is required'),
  }),
});

export const bulkDeleteMediaSchema = z.object({
  body: z.object({
    // We cap it at 100 per request to prevent payload abuse, but it easily handles >10
    mediaIds: z.array(z.string().trim().regex(objectIdRegex, 'A valid ID is required'))
               .min(1, 'Please provide at least one media ID to delete')
               .max(100, 'Cannot delete more than 100 items at once'), 
  }),
});