import Conversation from '../models/Conversation';
import mongoose from 'mongoose';

export const getOrCreateActiveConversation = async (
  orgId: mongoose.Types.ObjectId,
  subscriberId: mongoose.Types.ObjectId,
  lastMessageText: string
) => {
  // Finds an 'open' or 'pending' thread. If none exists, creates a new 'open' one.
  return await Conversation.findOneAndUpdate(
    { orgId, subscriberId, status: { $in: ['open', 'pending'] } },
    { 
      $set: { lastMessage: lastMessageText },
      $setOnInsert: { status: 'open' }
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
};
