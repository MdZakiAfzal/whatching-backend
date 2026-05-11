import Conversation from '../models/Conversation';
import mongoose from 'mongoose';

export const getOrCreateActiveConversation = async (
  orgId: mongoose.Types.ObjectId,
  subscriberId: mongoose.Types.ObjectId,
  lastMessageText: string,
  direction: 'inbound' | 'outbound' = 'outbound'
) => {
  const now = new Date();
  const update =
    direction === 'inbound'
      ? {
          $set: {
            lastMessage: lastMessageText,
            lastMessageAt: now,
            lastInboundAt: now,
            status: 'open',
            channel: 'whatsapp',
          },
          $inc: { unreadCount: 1 },
          $setOnInsert: {
            priority: 'normal',
          },
        }
      : {
          $set: {
            lastMessage: lastMessageText,
            lastMessageAt: now,
            lastOutboundAt: now,
            channel: 'whatsapp',
          },
          $setOnInsert: {
            status: 'open',
            priority: 'normal',
            unreadCount: 0,
          },
        };

  return await Conversation.findOneAndUpdate(
    { orgId, subscriberId },
    update,
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: false,
    }
  );
};
