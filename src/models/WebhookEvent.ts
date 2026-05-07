import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhookEvent extends Document {
  orgId?: mongoose.Types.ObjectId;
  provider: 'whatsapp';
  eventType: string;
  eventId: string;
  signatureVerified: boolean;
  payload: Record<string, any>;
  processingStatus: 'pending' | 'processing' | 'processed' | 'failed';
  processedAt?: Date;
  processingAttempts: number;
  error?: string;
}

const WebhookEventSchema: Schema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    provider: {
      type: String,
      enum: ['whatsapp'],
      required: true,
    },
    eventType: { type: String, required: true, trim: true },
    eventId: { type: String, required: true, trim: true },
    signatureVerified: { type: Boolean, default: false },
    payload: { type: Schema.Types.Mixed, required: true },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'processed', 'failed'],
      default: 'pending',
    },
    processedAt: Date,
    processingAttempts: { type: Number, default: 0 },
    error: String,
  },
  { timestamps: true }
);

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ orgId: 1, processingStatus: 1, createdAt: -1 });
WebhookEventSchema.index({ createdAt: 1 });

export default mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);
