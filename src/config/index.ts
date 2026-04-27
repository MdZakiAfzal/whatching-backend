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
  jwtSecret: envVars.data.JWT_SECRET,
  meta: {
    appId: envVars.data.META_APP_ID,
    appSecret: envVars.data.META_APP_SECRET,
  },
};