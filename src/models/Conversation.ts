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
  mode: 'interactive' | 'ai_fallback' | 'agent_manual';
  activeFlowId?: mongoose.Types.ObjectId;
  activeTriggerKey?: string;
  lastBotMessageId?: mongoose.Types.ObjectId;
  handoffRequestedAt?: Date;
  handoffReason?: string;
  manualTakeoverAt?: Date;
  manualTakeoverBy?: mongoose.Types.ObjectId;
  lastAgentReplyAt?: Date;
  automationPausedUntil?: Date;
  lastInboundMetaMessageId?: string;
  lastOutboundMetaMessageId?: string;
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
  mode: { 
    type: String, 
    enum: ['interactive', 'ai_fallback', 'agent_manual'], 
    default: 'interactive' 
  },
  activeFlowId: { type: Schema.Types.ObjectId, ref: 'BotFlow' },
  activeTriggerKey: { type: String, trim: true },
  lastBotMessageId: { type: Schema.Types.ObjectId, ref: 'Message' },
  handoffRequestedAt: { type: Date },
  handoffReason: { type: String, trim: true },
  manualTakeoverAt: { type: Date },
  manualTakeoverBy: { type: Schema.Types.ObjectId, ref: 'User' },
  lastAgentReplyAt: { type: Date },
  automationPausedUntil: { type: Date },
  lastInboundMetaMessageId: { type: String, trim: true },
  lastOutboundMetaMessageId: { type: String, trim: true },
}, { timestamps: true });

ConversationSchema.index({ orgId: 1, subscriberId: 1 }, { unique: true });
ConversationSchema.index({ orgId: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ orgId: 1, assignedTo: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ orgId: 1, mode: 1, lastMessageAt: -1 });
ConversationSchema.index({ orgId: 1, handoffRequestedAt: -1 });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
