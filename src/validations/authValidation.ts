import { z } from 'zod';

export const signupSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phoneNumber: z.string().min(10, 'Please provide a valid phone number'),
    password: z.string().min(8),
    passwordConfirm: z.string()
  })
}).refine((data) => data.body.password === data.body.passwordConfirm, {
  message: "Passwords do not match",
  path: ["passwordConfirm"], 
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Please provide a valid email address'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    passwordConfirm: z.string()
  })
}).refine((data) => data.body.password === data.body.passwordConfirm, {
  message: "Passwords do not match",
  path: ["body", "passwordConfirm"], 
});