import mongoose, { Schema, Document } from 'mongoose';

export interface IConversation extends Document {
  orgId: mongoose.Types.ObjectId;
  subscriberId: mongoose.Types.ObjectId;
  assignedTo?: mongoose.Types.ObjectId;
  status: 'open' | 'pending' | 'resolved';
  lastMessage?: string;
  lastMessageAt?: Date;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  unreadCount: number;
  channel: 'whatsapp';
  priority: 'low' | 'normal' | 'high';
}

const ConversationSchema: Schema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  subscriberId: { type: Schema.Types.ObjectId, ref: 'Subscriber', required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }, // The agent currently replying
  status: { type: String, enum: ['open', 'pending', 'resolved'], default: 'open' },
  lastMessage: { type: String },
  lastMessageAt: Date,
  lastInboundAt: Date,
  lastOutboundAt: Date,
  unreadCount: { type: Number, default: 0 },
  channel: { type: String, enum: ['whatsapp'], default: 'whatsapp' },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
}, { timestamps: true });

ConversationSchema.index({ orgId: 1, subscriberId: 1 }, { unique: true });
ConversationSchema.index({ orgId: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ orgId: 1, assignedTo: 1, status: 1, lastMessageAt: -1 });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
