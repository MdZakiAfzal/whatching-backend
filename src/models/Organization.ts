import mongoose, { Schema, Document } from 'mongoose';

export interface IOrganization extends Document {
  name: string;
  slug: string;
  planTier: 'basic' | 'pro' | 'enterprise';
  subscriptionStatus: 'active' | 'past_due' | 'trialing' | 'canceled';
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
      enum: ['basic', 'pro', 'enterprise'], 
      default: 'basic' 
    },
    subscriptionStatus: { 
      type: String, 
      enum: ['active', 'past_due', 'trialing', 'canceled'], 
      default: 'trialing' 
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