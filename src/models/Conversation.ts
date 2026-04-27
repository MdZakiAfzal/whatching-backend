import mongoose, { Schema, Document } from 'mongoose';

const ConversationSchema: Schema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  subscriberId: { type: Schema.Types.ObjectId, ref: 'Subscriber', required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }, // The agent currently replying
  status: { type: String, enum: ['open', 'pending', 'resolved'], default: 'open' },
  lastMessage: { type: String },
}, { timestamps: true });

export default mongoose.model('Conversation', ConversationSchema);