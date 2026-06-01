import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  orgId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  subscriberId: mongoose.Types.ObjectId;
  direction: 'inbound' | 'outbound' | 'system';
  source: 'customer' | 'agent' | 'bot' | 'system' | 'broadcast';
  senderUserId?: mongoose.Types.ObjectId;
  type:
    | 'text'
    | 'image'
    | 'audio'
    | 'document'
    | 'video'
    | 'template'
    | 'interactive'
    | 'location'
    | 'system'
    | 'unknown';
  metaMessageId?: string;
  templateId?: string;
  status: 'queued' | 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  payload: {
    text?: string;
    mediaId?: string;
    mediaUrl?: string;
    mimeType?: string;
    publicId?: string;
    caption?: string;
    filename?: string;
    sha256?: string;
    interactiveType?: string;
    interactiveReplyId?: string;
    interactiveReplyTitle?: string;
    systemEventType?: string;
    systemMessage?: string;
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
    replyContext?: {
      metaMessageId?: string;
      direction?: string;
      source?: string;
      previewText?: string;
    };
    storageStatus?: 'pending' | 'stored' | 'failed';
    [key: string]: unknown;
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
  direction: { type: String, enum: ['inbound', 'outbound', 'system'], required: true },
  source: {
    type: String,
    enum: ['customer', 'agent', 'bot', 'system', 'broadcast'],
    default: function () {
      if ((this as any).direction === 'inbound') {
        return 'customer';
      }
      return 'agent';
    },
  },
  senderUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  type: {
    type: String,
    enum: ['text', 'image', 'audio', 'document', 'video', 'template', 'interactive', 'location', 'system', 'unknown'],
    default: 'text',
  },
  metaMessageId: { type: String, trim: true },
  templateId: { type: String },
  status: { type: String, enum: ['queued', 'received', 'sent', 'delivered', 'read', 'failed'], required: true },
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
MessageSchema.index({ orgId: 1, conversationId: 1, _id: -1 });
MessageSchema.index(
  { orgId: 1, metaMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      metaMessageId: { $exists: true, $type: 'string' },
    },
  }
);
MessageSchema.index({ orgId: 1, status: 1 });

export default mongoose.model<IMessage>('Message', MessageSchema);
