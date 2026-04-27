import mongoose, { Schema, Document } from 'mongoose';

export interface IMembership extends Document {
  userId: mongoose.Types.ObjectId;
  orgId: mongoose.Types.ObjectId;
  role: 'owner' | 'admin' | 'agent';
  status: 'active' | 'invited' | 'disabled';
}

const MembershipSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    role: { 
      type: String, 
      enum: ['owner', 'admin', 'agent'], 
      default: 'agent' 
    },
    status: { 
      type: String, 
      enum: ['active', 'invited', 'disabled'], 
      default: 'active' 
    },
  },
  { timestamps: true }
);

// Prevent a user from having multiple memberships in the SAME organization
MembershipSchema.index({ userId: 1, orgId: 1 }, { unique: true });

export default mongoose.model<IMembership>('Membership', MembershipSchema);