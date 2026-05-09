import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';

const GRAPH_API_VERSION = 'v20.0';

/**
 * Exchanges the code from Embedded Signup for a permanent token
 */
export const exchangeCodeForToken = async (code: string): Promise<string> => {
  try {
    const response = await axios.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`, {
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

interface MetaPhoneNumberSummary {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

interface ResolvedMetaConnection {
  wabaId: string;
  businessAccountName?: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

const buildAuthHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

export const resolveMetaConnection = async (
  accessToken: string,
  wabaId: string,
  phoneNumberId: string
): Promise<ResolvedMetaConnection> => {
  try {
    const [wabaResponse, phoneNumbersResponse] = await Promise.all([
      axios.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}`, {
        headers: buildAuthHeaders(accessToken),
        params: {
          fields: 'id,name',
        },
      }),
      axios.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/phone_numbers`, {
        headers: buildAuthHeaders(accessToken),
        params: {
          fields: 'id,display_phone_number,verified_name',
        },
      }),
    ]);

    const matchedPhoneNumber = (phoneNumbersResponse.data?.data ?? []).find(
      (phoneNumber: MetaPhoneNumberSummary) => phoneNumber.id === phoneNumberId
    );

    if (!matchedPhoneNumber) {
      throw new Error('The supplied phone number is not attached to the provided WhatsApp Business Account.');
    }

    return {
      wabaId: wabaResponse.data.id,
      businessAccountName: wabaResponse.data.name,
      phoneNumberId: matchedPhoneNumber.id,
      displayPhoneNumber: matchedPhoneNumber.display_phone_number,
      verifiedName: matchedPhoneNumber.verified_name,
    };
  } catch (error: any) {
    const message =
      error.response?.data?.error?.message || error.message || 'Failed to verify Meta connection';
    throw new Error(message);
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
