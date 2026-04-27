import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscriber extends Document {
  orgId: mongoose.Types.ObjectId;
  phoneNumber: string; // The primary ID for WhatsApp
  firstName?: string;
  lastName?: string;
  tags: string[]; // For segmentation (e.g., "VIP", "New Lead")
  metadata: Record<string, any>; // Flexible "Database" part for custom fields
  isOptedIn: boolean;
  lastInteraction: Date;
}

const SubscriberSchema: Schema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  phoneNumber: { type: String, required: true },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  tags: [{ type: String }],
  metadata: { type: Map, of: Schema.Types.Mixed }, // Supports dynamic "Gym" or "Salon" data
  isOptedIn: { type: Boolean, default: true },
  lastInteraction: { type: Date, default: Date.now }
}, { timestamps: true });

// CRITICAL: Ensure phone is unique PER Organization
SubscriberSchema.index({ orgId: 1, phoneNumber: 1 }, { unique: true });

export default mongoose.model<ISubscriber>('Subscriber', SubscriberSchema);