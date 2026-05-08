import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  orgId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  subscriberId: mongoose.Types.ObjectId;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'template' | 'unknown';
  metaMessageId: string;
  templateId?: string;
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  payload: {
    text?: string;
    mediaId?: string;
  };
  errorCode?: string;
  errorMessage?: string;
  sentAt: Date;
  deliveredAt?: Date;
  readAt?: Date;
  failedAt?: Date;
}

const MessageSchema: Schema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  subscriberId: { type: Schema.Types.ObjectId, ref: 'Subscriber', required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  type: { type: String, enum: ['text', 'image', 'template', 'unknown'], default: 'text' },
  metaMessageId: { type: String, required: true },
  templateId: { type: String },
  status: { type: String, enum: ['received', 'sent', 'delivered', 'read', 'failed'], required: true },
  payload: { type: Schema.Types.Mixed, default: {} },
  errorCode: String,
  errorMessage: String,
  sentAt: { type: Date, default: Date.now },
  deliveredAt: Date,
  readAt: Date,
  failedAt: Date,
}, { timestamps: true });

// CRITICAL INDEXES from the Blueprint
MessageSchema.index({ orgId: 1, conversationId: 1, createdAt: -1 });
MessageSchema.index({ orgId: 1, metaMessageId: 1 }, { unique: true });
MessageSchema.index({ orgId: 1, status: 1 });

export default mongoose.model<IMessage>('Message', MessageSchema);