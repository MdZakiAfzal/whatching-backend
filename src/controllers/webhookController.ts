import { Request, Response } from 'express';
import mongoose from 'mongoose';
import * as paymentService from '../services/paymentService';
import Organization from '../models/Organization';
import Transaction from '../models/Transaction';
import { config } from '../config';
import catchAsync from '../utils/catchAsync';

type RawBodyRequest = Request & { rawBody?: string };

const mapWebhookSubscriptionStatus = (status: string) => {
  switch (status) {
    case 'active':
      return 'active';
    case 'pending':
    case 'halted':
      return 'past_due';
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'canceled';
    case 'authenticated':
    case 'created':
    default:
      return 'pending_payment';
  }
};

const applyWalletTopupOnce = async (orgId: string, amount: number, referenceId: string) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const result = await Transaction.updateOne(
        { referenceId },
        {
          $setOnInsert: {
            orgId,
            amount,
            type: 'topup',
            status: 'success',
            description: `Wallet funded: ₹${amount}`,
            referenceId,
          },
        },
        { upsert: true, session }
      );

      if (result.upsertedCount === 0) {
        return;
      }

      await Organization.findByIdAndUpdate(
        orgId,
        { $inc: { walletBalance: amount } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
};

const recordSubscriptionChargeOnce = async (
  orgId: string,
  amount: number,
  referenceId: string,
  planId: string,
  subscriptionId: string
) => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const result = await Transaction.updateOne(
        { referenceId },
        {
          $setOnInsert: {
            orgId,
            amount,
            type: 'subscription_payment',
            status: 'success',
            description: `Infrastructure Plan Renewal: ${planId}`,
            referenceId,
          },
        },
        { upsert: true, session }
      );

      if (result.upsertedCount === 0) {
        return;
      }

      await Organization.findByIdAndUpdate(
        orgId,
        {
          planTier: planId === config.razorpay.plans.pro ? 'pro' : 'basic',
          subscriptionStatus: 'active',
          razorpaySubscriptionId: subscriptionId,
        },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
};

export const handleRazorpayWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const rawBody = (req as RawBodyRequest).rawBody;
  
  // 1. Security: Verify request authenticity
  if (!signature || !rawBody) {
    return res.sendStatus(400);
  }

  const isValid = paymentService.verifyWebhookSignature(rawBody, signature);
  if (!isValid) return res.sendStatus(400);

  const { event, payload } = req.body;

  if (config.env === 'development') {
    console.log(`[Razorpay webhook] event=${event}`);
  }

  // 2. LOGIC FOR SUBSCRIPTIONS (Infrastructure Fee)
  if (event.startsWith('subscription.')) {
    const subEntity = payload.subscription?.entity;
    const orgId = subEntity?.notes?.orgId;

    if (!subEntity || !orgId) {
      return res.status(200).json({ status: 'ok' });
    }

    if (event === 'subscription.authenticated') {
      await Organization.findByIdAndUpdate(orgId, {
        razorpaySubscriptionId: subEntity.id,
        subscriptionStatus: 'pending_payment',
      });
    }

    if (event === 'subscription.activated') {
      await Organization.findByIdAndUpdate(orgId, {
        razorpaySubscriptionId: subEntity.id,
        planTier: subEntity.plan_id === config.razorpay.plans.pro ? 'pro' : 'basic',
        subscriptionStatus: 'active',
        razorpayCustomerId: subEntity.customer_id,
      });
    }

    if (event === 'subscription.charged') {
      const paymentEntity = payload.payment?.entity;
      if (!paymentEntity) {
        await Organization.findByIdAndUpdate(orgId, {
          razorpaySubscriptionId: subEntity.id,
          planTier: subEntity.plan_id === config.razorpay.plans.pro ? 'pro' : 'basic',
          subscriptionStatus: mapWebhookSubscriptionStatus(subEntity.status),
          razorpayCustomerId: subEntity.customer_id,
        });
        return res.status(200).json({ status: 'ok' });
      }

      const amount = paymentEntity.amount / 100;
      const referenceId = paymentEntity.id; // Unique ID for this specific month's charge

      await recordSubscriptionChargeOnce(
        orgId,
        amount,
        referenceId,
        subEntity.plan_id,
        subEntity.id
      );
    }

    if (event === 'subscription.pending' || event === 'subscription.halted') {
      await Organization.findByIdAndUpdate(orgId, {
        razorpaySubscriptionId: subEntity.id,
        subscriptionStatus: mapWebhookSubscriptionStatus(subEntity.status),
        razorpayCustomerId: subEntity.customer_id,
      });
    }

    if (event === 'subscription.cancelled') {
      await Organization.findByIdAndUpdate(orgId, { 
        subscriptionStatus: 'canceled', 
        planTier: 'none',
        razorpaySubscriptionId: undefined,
      });
    }

    if (event === 'subscription.completed' || event === 'subscription.expired') {
      await Organization.findByIdAndUpdate(orgId, {
        subscriptionStatus: 'canceled',
        razorpaySubscriptionId: undefined,
      });
    }
  }

  // 3. LOGIC FOR WALLET (Idempotent Top-up)
  if (event === 'payment_link.paid' || event === 'order.paid') {
    const orderEntity = payload.order?.entity;
    
    if (orderEntity?.notes?.type === 'wallet_topup') {
      const orgId = orderEntity.notes.orgId;
      const amount = orderEntity.amount_paid / 100;
      
      const razorpayPaymentId = payload.payment ? payload.payment.entity.id : orderEntity.id;

      await applyWalletTopupOnce(orgId, amount, razorpayPaymentId);
    }
  }

  res.status(200).json({ status: 'ok' });
});
