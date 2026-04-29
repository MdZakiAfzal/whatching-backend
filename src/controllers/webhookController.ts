import { Request, Response } from 'express';
import * as paymentService from '../services/paymentService';
import Organization from '../models/Organization';
import Transaction from '../models/Transaction';
import { config } from '../config';
import catchAsync from '../utils/catchAsync';

export const handleRazorpayWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  
  // 1. Security: Verify request authenticity
  const isValid = paymentService.verifyWebhookSignature(JSON.stringify(req.body), signature);
  if (!isValid) return res.sendStatus(400);

  const { event, payload } = req.body;

  // 2. LOGIC FOR SUBSCRIPTIONS (Infrastructure Fee)
  if (event.startsWith('subscription.')) {
    const subEntity = payload.subscription.entity;
    const orgId = subEntity.notes.orgId;

    if (event === 'subscription.authenticated') {
      await Organization.findByIdAndUpdate(orgId, { razorpaySubscriptionId: subEntity.id });
    }

    if (event === 'subscription.charged') {
      const paymentEntity = payload.payment.entity;
      const amount = paymentEntity.amount / 100;
      const referenceId = paymentEntity.id; // Unique ID for this specific month's charge

      // IDEMPOTENCY CHECK: Solve subscription double-billing
      const existingTx = await Transaction.findOne({ referenceId });
      
      if (!existingTx) {
        // Atomic update: Set active and flip the plan tier
        await Organization.findByIdAndUpdate(orgId, {
          planTier: subEntity.plan_id === config.razorpay.plans.pro ? 'pro' : 'basic',
          subscriptionStatus: 'active'
        });

        // Record the transaction for billing history
        await Transaction.create({
          orgId,
          amount,
          type: 'subscription_payment',
          status: 'success',
          description: `Infrastructure Plan Renewal: ${subEntity.plan_id}`,
          referenceId
        });
      }
    }

    if (event === 'subscription.cancelled') {
      await Organization.findByIdAndUpdate(orgId, { 
        subscriptionStatus: 'canceled', 
        planTier: 'none' 
      });
    }
  }

  // 3. LOGIC FOR WALLET (Idempotent Top-up)
  if (event === 'payment_link.paid' || event === 'order.paid') {
    const orderEntity = payload.order.entity;
    
    if (orderEntity.notes.type === 'wallet_topup') {
      const orgId = orderEntity.notes.orgId;
      const amount = orderEntity.amount_paid / 100;
      
      // FIX: Access payment ID safely. Fallback to order ID if necessary for simulation.
      const razorpayPaymentId = payload.payment ? payload.payment.entity.id : orderEntity.id;

      // IDEMPOTENCY CHECK: Ensure we don't process the same payment twice
      const existingTx = await Transaction.findOne({ referenceId: razorpayPaymentId });
      
      if (!existingTx) {
        // Atomic update: Fund wallet
        await Organization.findByIdAndUpdate(orgId, { $inc: { walletBalance: amount } });
        
        // Populate Transactions table for wallet top-ups
        await Transaction.create({
          orgId,
          amount,
          type: 'topup',
          status: 'success',
          description: `Wallet funded: ₹${amount}`,
          referenceId: razorpayPaymentId
        });
      }
    }
  }

  res.status(200).json({ status: 'ok' });
});