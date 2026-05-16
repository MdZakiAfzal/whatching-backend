import { Response, NextFunction } from 'express';
import { config } from '../config';
import Organization from '../models/Organization';
import Transaction from '../models/Transaction';
import * as paymentService from '../services/paymentService';
import { RazorpaySubscription } from '../services/paymentService';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

const OPEN_CHECKOUT_STATUSES = new Set(['created', 'authenticated']);
const BLOCKED_CHECKOUT_STATUSES = new Set(['pending', 'halted']);
const TERMINAL_STATUSES = new Set(['cancelled', 'completed', 'expired']);
const LEGACY_TRANSACTION_TYPES = new Set(['topup', 'broadcast_fee', 'refund']);

const getPlanTierFromPlanId = (planId: string): 'basic' | 'pro' =>
  planId === config.razorpay.plans.pro ? 'pro' : 'basic';

const mapRemoteStatusToLocalStatus = (
  status: RazorpaySubscription['status']
): 'pending_payment' | 'active' | 'past_due' | 'canceled' => {
  if (status === 'active') return 'active';
  if (status === 'pending' || status === 'halted') return 'past_due';
  if (TERMINAL_STATUSES.has(status)) return 'canceled';
  return 'pending_payment';
};

const syncOrganizationSubscription = async (organization: any) => {
  if (!organization.razorpaySubscriptionId) {
    return { organization, remoteSubscription: null as RazorpaySubscription | null };
  }

  const remoteSubscription = await paymentService.fetchSubscription(organization.razorpaySubscriptionId);
  organization.subscriptionStatus = mapRemoteStatusToLocalStatus(remoteSubscription.status);
  organization.razorpayCustomerId = remoteSubscription.customer_id;

  if (remoteSubscription.status === 'active') {
    organization.planTier = getPlanTierFromPlanId(remoteSubscription.plan_id);
    organization.razorpaySubscriptionId = remoteSubscription.id;
  } else if (TERMINAL_STATUSES.has(remoteSubscription.status)) {
    organization.planTier = 'none';
    organization.razorpaySubscriptionId = undefined;
  }

  await organization.save({ validateBeforeSave: false });

  return { organization, remoteSubscription };
};

export const startSubscription = catchAsync(async (req: any, res: Response) => {
  const { tier } = req.body;
  if (tier !== 'basic' && tier !== 'pro') {
    throw new AppError('Please choose a valid subscription tier.', 400);
  }

  const organization = await Organization.findById(req.org._id);
  if (!organization) {
    throw new AppError('Organization not found.', 404);
  }

  if (organization.razorpaySubscriptionId) {
    const { organization: syncedOrganization, remoteSubscription } =
      await syncOrganizationSubscription(organization);

    if (remoteSubscription?.status === 'active') {
      return res.status(200).json({
        status: 'success',
        message: 'Subscription is already active. Local billing state has been synced.',
        data: {
          subscriptionId: remoteSubscription.id,
          subscriptionStatus: remoteSubscription.status,
          organization: syncedOrganization,
          synced: true,
        },
      });
    }

    if (remoteSubscription && OPEN_CHECKOUT_STATUSES.has(remoteSubscription.status) && remoteSubscription.short_url) {
      return res.status(200).json({
        status: 'success',
        message: 'Existing subscription checkout is still pending. Reusing the same payment link.',
        data: {
          subscriptionId: remoteSubscription.id,
          paymentUrl: remoteSubscription.short_url,
          key: config.razorpay.keyId,
          subscriptionStatus: remoteSubscription.status,
          synced: true,
        },
      });
    }

    if (remoteSubscription && BLOCKED_CHECKOUT_STATUSES.has(remoteSubscription.status)) {
      throw new AppError(
        `The existing subscription is currently ${remoteSubscription.status} in Razorpay. Please resolve it there or sync again after payment completion.`,
        409
      );
    }
  }

  const subscription = await paymentService.createSubscription(String(req.org._id), tier);

  organization.razorpaySubscriptionId = subscription.id;
  organization.subscriptionStatus = 'pending_payment';
  await organization.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    data: { 
      subscriptionId: subscription.id,
      paymentUrl: subscription.short_url,
      key: config.razorpay.keyId 
    }
  });
});

export const syncMySubscription = catchAsync(async (req: any, res: Response) => {
  const organization = await Organization.findById(req.org._id);
  if (!organization) {
    throw new AppError('Organization not found.', 404);
  }

  const { organization: syncedOrganization, remoteSubscription } =
    await syncOrganizationSubscription(organization);

  res.status(200).json({
    status: 'success',
    data: {
      organization: syncedOrganization,
      remoteSubscription,
      synced: true,
    },
  });
});

export const topupWallet = catchAsync(async (req: any, res: Response) => {
  const { amount } = req.body;
  if (!Number.isFinite(amount) || amount < 500) {
    throw new AppError('Minimum top-up is ₹500', 400);
  }

  const paymentLink = await paymentService.createWalletLink(String(req.org._id), amount, {
    name: req.user.name,
    email: req.user.email,
    phoneNumber: req.user.phoneNumber,
  });

  res.status(200).json({
    status: 'success',
    message:
      'Wallet top-up link created. This balance is legacy/internal and is not used for Meta messaging charges.',
    data: { 
      orderId: paymentLink.id,
      paymentUrl: paymentLink.short_url,
      amount: paymentLink.amount, 
      key: config.razorpay.keyId,
      legacyWallet: true,
    }
  });
});

export const getBillingHistory = catchAsync(async (req: any, res: Response) => {
  const transactions = await Transaction.find({ orgId: req.org._id }).sort('-createdAt');
  const decoratedTransactions = transactions.map((transaction) => {
    const plainTransaction = transaction.toObject();
    const legacy = LEGACY_TRANSACTION_TYPES.has(plainTransaction.type);

    return {
      ...plainTransaction,
      legacy,
      billingCategory: legacy ? 'legacy_wallet' : 'saas_subscription',
    };
  });

  res.status(200).json({ status: 'success', data: { transactions: decoratedTransactions } });
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
