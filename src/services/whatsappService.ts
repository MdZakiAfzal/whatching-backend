import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';

/**
 * Exchanges the code from Embedded Signup for a permanent token
 */
export const exchangeCodeForToken = async (code: string): Promise<string> => {
  try {
    const response = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token`, {
      params: {
        client_id: config.meta.appId,
        client_secret: config.meta.appSecret,
        code: code,
      },
    });

    return response.data.access_token;
  } catch (error: any) {
    console.error('Meta Token Exchange Error:', error.response?.data || error.message);
    throw new Error('Failed to exchange code for Meta access token');
  }
};

export const verifyMetaWebhookSignature = (rawBody: string, signatureHeader?: string): boolean => {
  if (!signatureHeader) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', config.meta.appSecret)
    .update(rawBody)
    .digest('hex');

  const expectedSignature = `sha256=${expected}`;
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};
