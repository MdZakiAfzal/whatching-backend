import axios from 'axios';
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