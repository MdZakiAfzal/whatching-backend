import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  EMAIL_DELIVERY_MODE: z.enum(['smtp', 'log']).default('smtp'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  MONGODB_URI: z.string().url(),
  JWT_SECRET: z.string().min(32),
  META_APP_ID: z.string(),
  META_APP_SECRET: z.string(),
  META_VERIFY_TOKEN: z.string().min(16),
  META_TEMPLATE_FEE: z.string().default('0.8631'), // Default fee as a string to maintain precision
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
  frontendUrl: envVars.data.FRONTEND_URL,
  emailDeliveryMode: envVars.data.EMAIL_DELIVERY_MODE,
  redisUrl: envVars.data.REDIS_URL,
  mongoUri: envVars.data.MONGODB_URI,
  emailHost: process.env.EMAIL_HOST,
  emailPort: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : undefined,
  emailUser: process.env.EMAIL_USER,
  emailPassword: process.env.EMAIL_PASSWORD,
  emailFrom: process.env.EMAIL_FROM,
  jwtSecret: envVars.data.JWT_SECRET,
  meta: {
    appId: envVars.data.META_APP_ID,
    appSecret: envVars.data.META_APP_SECRET,
    verifyToken: envVars.data.META_VERIFY_TOKEN,
    templateFee: parseFloat(envVars.data.META_TEMPLATE_FEE), // Convert fee to a number for calculations
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
