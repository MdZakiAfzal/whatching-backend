import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
  orgId: mongoose.Types.ObjectId;
  amount: number; // Positive for top-up, negative for message cost
  type: 'topup' | 'broadcast_fee' | 'refund' | 'subscription_payment';
  status: 'pending' | 'success' | 'failed';
  description: string;
  referenceId?: string; // ID of the broadcast or payment gateway ID
}

const TransactionSchema: Schema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  amount: { type: Number, required: true },
  type: { 
    type: String, 
    enum: ['topup', 'broadcast_fee', 'refund', 'subscription_payment'], 
    required: true 
  },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'success' },
  description: { type: String, required: true },
  referenceId: { type: String }
}, { timestamps: true });

TransactionSchema.index({ orgId: 1, createdAt: -1 });

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);