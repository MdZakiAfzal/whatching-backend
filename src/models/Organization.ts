import mongoose, { Schema, Document } from 'mongoose';

export interface IOrganization extends Document {
  name: string;
  slug: string;
  planTier: 'none' | 'basic' | 'pro' | 'enterprise';
  subscriptionStatus: 'pending_payment' | 'active' | 'past_due' | 'trialing' | 'canceled';
  metaConfig: {
    wabaId?: string;
    phoneNumberId?: string;
    accessToken?: string;
  };
  walletBalance: number;
  usage: {
    aiTokensUsed: number;
    subscribersCount: number;
  };
}

const OrganizationSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
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
      wabaId: { type: String, sparse: true },
      phoneNumberId: { type: String, sparse: true },
      accessToken: { type: String },
    },
    walletBalance: { type: Number, default: 0 }, // For promotional msg credits
    usage: {
      aiTokensUsed: { type: Number, default: 0 },
      subscribersCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model<IOrganization>('Organization', OrganizationSchema);