import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '../config';

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

export type RazorpaySubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired';

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: RazorpaySubscriptionStatus;
  short_url?: string;
  customer_id?: string;
  paid_count?: number;
}

export const createSubscription = async (orgId: string, tier: 'basic' | 'pro') => {
  const planId = tier === 'basic' ? config.razorpay.plans.basic : config.razorpay.plans.pro;
  return await razorpay.subscriptions.create({
    plan_id: planId,
    total_count: 60, // 5 years
    quantity: 1,
    customer_notify: 1,
    notes: { orgId } // Critical for webhook identification
  });
};

export const createWalletOrder = async (orgId: string, amount: number) => {
  const shortId = orgId.toString().slice(-10);
  const receiptId = `tp_${shortId}_${Date.now()}`;
  return await razorpay.orders.create({
    amount: amount * 100, // INR to Paise
    currency: 'INR',
    receipt: receiptId,
    notes: { orgId, type: 'wallet_topup' }
  });
};

export const cancelSubscription = async (subscriptionId: string) => {
  return await razorpay.subscriptions.cancel(subscriptionId, true);
};

export const fetchSubscription = async (subscriptionId: string): Promise<RazorpaySubscription> => {
  return await razorpay.subscriptions.fetch(subscriptionId) as RazorpaySubscription;
};

export const verifyWebhookSignature = (rawBody: string, signature: string) => {
  const expected = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};

export const createWalletLink = async (
  orgId: string,
  amount: number,
  customer: { name: string; email: string; phoneNumber?: string }
) => {
  // We use the Payment Link API instead of the Order API to get a URL
  return await razorpay.paymentLink.create({
    amount: amount * 100,
    currency: 'INR',
    accept_partial: false,
    description: `Wallet Top-up for Whatching`,
    customer: {
      name: customer.name,
      email: customer.email,
      contact: customer.phoneNumber,
    },
    notify: {
      sms: true,
      email: true
    },
    reminder_enable: true,
    notes: { 
      orgId: orgId.toString(), 
      type: 'wallet_topup' 
    },
    // The link expires in 15 mins for security
    expire_by: Math.floor(Date.now() / 1000) + 16 * 60, 
  });
};
