import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '../config';

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

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

export const verifyWebhookSignature = (rawBody: string, signature: string) => {
  const expected = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
};

export const createWalletLink = async (orgId: string, amount: number) => {
  // We use the Payment Link API instead of the Order API to get a URL
  return await razorpay.paymentLink.create({
    amount: amount * 100,
    currency: 'INR',
    accept_partial: false,
    description: `Wallet Top-up for Whatching`,
    customer: {
      name: "Business Owner", // You can pull this from req.user later
      email: "owner@example.com",
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