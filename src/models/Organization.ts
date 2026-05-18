import mongoose, { Schema, Document } from 'mongoose';
import {
  MessagingBillingCreditSharingStatus,
  MessagingBillingMode,
  MessagingBillingProvider,
} from '../utils/messagingBilling';

export interface IOrganization extends Document {
  name: string;
  slug: string;
  timezone: string;
  planTier: 'none' | 'basic' | 'pro' | 'enterprise';
  subscriptionStatus: 'pending_payment' | 'active' | 'past_due' | 'trialing' | 'canceled';
  metaConfig: {
    wabaId?: string;
    phoneNumberId?: string;
    accessToken?: string;
    status?: 'pending' | 'ready' | 'disconnected';
    connectedAt?: Date;
    webhookVerifiedAt?: Date;
    lastTemplateSyncAt?: Date;
    lastHealthCheckAt?: Date;
    businessAccountName?: string;
    displayPhoneNumber?: string;
    qualityRating?: string;
    qualityStatus?: string;
    messagingLimitTier?: string;
    lastMessagingLimitSyncAt?: Date;
    activeAlerts?: Array<{
      code: string;
      severity: 'info' | 'warning' | 'critical';
      message: string;
      createdAt?: Date;
      lastTriggeredAt?: Date;
    }>;
  };
  messagingBilling: {
    mode: MessagingBillingMode;
    provider: MessagingBillingProvider;
    creditSharingStatus: MessagingBillingCreditSharingStatus;
    lineOfCreditId?: string;
  };
  walletBalance: number;
  usage: {
    aiTokensUsed: number;
    subscribersCount: number;
    templateMessagesSent: number;
    sessionMessagesSent: number;
    lastMessageAt?: Date;
  };
  razorpaySubscriptionId?: string; 
  razorpayCustomerId?: string;
}

const OrganizationSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    timezone: { type: String, default: 'UTC', trim: true },
    planTier: { 
      type: String, 
      enum: ['none', 'basic', 'pro', 'enterprise'], 
      default: 'none' 
    },
    subscriptionStatus: { 
      type: String, 
      enum: ['pending_payment', 'active', 'past_due', 'trialing', 'canceled'], 
      default: 'pending_payment' 
    },
    metaConfig: {
      wabaId: { type: String,},
      phoneNumberId: { type: String,},
      accessToken: { type: String, select: false },
      status: { type: String, enum: ['pending', 'ready', 'disconnected'], default: 'pending' },
      connectedAt: Date,
      webhookVerifiedAt: Date,
      lastTemplateSyncAt: Date,
      lastHealthCheckAt: Date,
      businessAccountName: String,
      displayPhoneNumber: String,
      qualityRating: { type: String, trim: true },
      qualityStatus: { type: String, trim: true },
      messagingLimitTier: { type: String, trim: true },
      lastMessagingLimitSyncAt: Date,
      activeAlerts: [
        {
          code: { type: String, required: true, trim: true },
          severity: {
            type: String,
            enum: ['info', 'warning', 'critical'],
            default: 'info',
          },
          message: { type: String, required: true, trim: true },
          createdAt: Date,
          lastTriggeredAt: Date,
        },
      ],
    },
    messagingBilling: {
      mode: {
        type: String,
        enum: ['meta_direct', 'partner_credit_line'],
        default: 'meta_direct',
      },
      provider: {
        type: String,
        enum: ['meta'],
        default: 'meta',
      },
      creditSharingStatus: {
        type: String,
        enum: ['not_applicable', 'pending', 'shared', 'revoked'],
        default: 'not_applicable',
      },
      lineOfCreditId: { type: String, trim: true },
    },
    walletBalance: { type: Number, default: 0 }, // Legacy internal balance. Not used for Meta messaging charges.
    usage: {
      aiTokensUsed: { type: Number, default: 0 },
      subscribersCount: { type: Number, default: 0 },
      templateMessagesSent: { type: Number, default: 0 },
      sessionMessagesSent: { type: Number, default: 0 },
      lastMessageAt: Date,
    },
    razorpaySubscriptionId: { type: String, sparse: true },
    razorpayCustomerId: { type: String, sparse: true },
  },
  { timestamps: true }
);

OrganizationSchema.index(
  { 'metaConfig.phoneNumberId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'metaConfig.phoneNumberId': { $exists: true, $type: 'string' },
    },
  }
);

OrganizationSchema.index(
  { 'metaConfig.wabaId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'metaConfig.wabaId': { $exists: true, $type: 'string' },
    },
  }
);

export default mongoose.model<IOrganization>('Organization', OrganizationSchema);
