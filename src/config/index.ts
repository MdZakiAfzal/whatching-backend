import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().url(),
  JWT_SECRET: z.string().min(32),
  META_APP_ID: z.string(),
  META_APP_SECRET: z.string(),
  META_VERIFY_TOKEN: z.string().min(16),
  ENCRYPTION_KEY: z.string().length(32, 'Encryption key must be exactly 32 characters'),
  RAZORPAY_KEY_ID: z.string(),
  RAZORPAY_KEY_SECRET: z.string(),
  RAZORPAY_WEBHOOK_SECRET: z.string(),
  RAZORPAY_BASIC_PLAN_ID: z.string(),
  RAZORPAY_PRO_PLAN_ID: z.string(),
});

const envVars = envSchema.safeParse(process.env);

if (!envVars.success) {
  console.error('❌ Invalid environment variables:', envVars.error.format());
  process.exit(1);
}

export const config = {
  port: parseInt(envVars.data.PORT, 10),
  env: envVars.data.NODE_ENV,
  mongoUri: envVars.data.MONGODB_URI,
  emailHost: process.env.EMAIL_HOST,
  emailPort: Number(process.env.EMAIL_PORT),
  emailUser: process.env.EMAIL_USER,
  emailPassword: process.env.EMAIL_PASSWORD,
  emailFrom: process.env.EMAIL_FROM,
  jwtSecret: envVars.data.JWT_SECRET,
  meta: {
    appId: envVars.data.META_APP_ID,
    appSecret: envVars.data.META_APP_SECRET,
    verifyToken: process.env.META_VERIFY_TOKEN,
  },
  razorpay: {
    keyId: envVars.data.RAZORPAY_KEY_ID,
    keySecret: envVars.data.RAZORPAY_KEY_SECRET,
    webhookSecret: envVars.data.RAZORPAY_WEBHOOK_SECRET,
    plans: {
      basic: envVars.data.RAZORPAY_BASIC_PLAN_ID,
      pro: envVars.data.RAZORPAY_PRO_PLAN_ID,
    }
  },
  encryptionKey: envVars.data.ENCRYPTION_KEY,
};