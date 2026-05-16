import mongoose, { Schema, Document } from 'mongoose';

export type BroadcastRecipientStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'skipped'
  | 'canceled';

export interface IBroadcastRecipient extends Document {
  orgId: mongoose.Types.ObjectId;
  broadcastId: mongoose.Types.ObjectId;
  subscriberId: mongoose.Types.ObjectId;
  phoneNumber: string;
  status: BroadcastRecipientStatus;
  messageId?: mongoose.Types.ObjectId;
  metaMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  queuedAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  failedAt?: Date;
  skippedAt?: Date;
  canceledAt?: Date;
}

const BroadcastRecipientSchema: Schema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    broadcastId: { type: Schema.Types.ObjectId, ref: 'Broadcast', required: true },
    subscriberId: { type: Schema.Types.ObjectId, ref: 'Subscriber', required: true },
    phoneNumber: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'canceled'],
      default: 'pending',
    },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    metaMessageId: { type: String, trim: true },
    errorCode: String,
    errorMessage: String,
    queuedAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date,
    skippedAt: Date,
    canceledAt: Date,
  },
  { timestamps: true }
);

BroadcastRecipientSchema.index({ orgId: 1, broadcastId: 1, status: 1, createdAt: -1 });
BroadcastRecipientSchema.index({ broadcastId: 1, subscriberId: 1 }, { unique: true });
BroadcastRecipientSchema.index(
  { orgId: 1, messageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      messageId: { $exists: true, $type: 'objectId' },
    },
  }
);
BroadcastRecipientSchema.index(
  { orgId: 1, metaMessageId: 1 },
  {
    partialFilterExpression: {
      metaMessageId: { $exists: true, $type: 'string' },
    },
  }
);

export default mongoose.model<IBroadcastRecipient>('BroadcastRecipient', BroadcastRecipientSchema);
