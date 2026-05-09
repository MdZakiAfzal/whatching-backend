import { z } from 'zod';

export const setupOrganizationSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Business name must be at least 2 characters'),
  }),
});

export const connectMetaSchema = z.object({
  body: z
    .object({
      wabaId: z.string().trim().min(1, 'WABA ID is required'),
      phoneNumberId: z.string().trim().min(1, 'Phone number ID is required'),
      accessToken: z.string().trim().optional(),
      code: z.string().trim().optional(),
    })
    .refine((data) => Boolean(data.accessToken || data.code), {
      message: 'A Meta access token is required',
      path: ['accessToken'],
    }),
});
