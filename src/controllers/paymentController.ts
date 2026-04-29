import { Response, NextFunction } from 'express';
import { config } from '../config';
import Organization from '../models/Organization';
import Transaction from '../models/Transaction';
import * as paymentService from '../services/paymentService';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

export const startSubscription = catchAsync(async (req: any, res: Response) => {
  const { tier } = req.body;
  const subscription = await paymentService.createSubscription(req.org._id, tier);

  res.status(200).json({
    status: 'success',
    data: { 
      subscriptionId: subscription.id,
      paymentUrl: subscription.short_url,
      key: config.razorpay.keyId 
    }
  });
});

export const topupWallet = catchAsync(async (req: any, res: Response) => {
  const { amount } = req.body;
  if (amount < 500) throw new AppError('Minimum top-up is ₹500', 400);

  // FIX: Using the new Link service
  const paymentLink = await paymentService.createWalletLink(req.org._id, amount);

  res.status(200).json({
    status: 'success',
    data: { 
      orderId: paymentLink.id,
      paymentUrl: paymentLink.short_url, // This is what you were looking for!
      amount: paymentLink.amount, 
      key: config.razorpay.keyId 
    }
  });
});

export const getBillingHistory = catchAsync(async (req: any, res: Response) => {
  const transactions = await Transaction.find({ orgId: req.org._id }).sort('-createdAt');
  res.status(200).json({ status: 'success', data: { transactions } });
});

export const cancelMySubscription = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const org = await Organization.findById(req.org._id);
  
  // FIX: 'next' is now defined in the parameters above
  if (!org?.razorpaySubscriptionId) {
    return next(new AppError('No active subscription found for this business.', 404));
  }

  await paymentService.cancelSubscription(org.razorpaySubscriptionId);

  res.status(200).json({
    status: 'success',
    message: 'Your subscription will remain active until the end of the billing period.'
  });
});