import Conversation from '../models/Conversation';
import mongoose from 'mongoose';

export const getOrCreateActiveConversation = async (
  orgId: mongoose.Types.ObjectId,
  subscriberId: mongoose.Types.ObjectId,
  lastMessageText: string,
  direction: 'inbound' | 'outbound' = 'outbound'
) => {
  const now = new Date();
  const update: Record<string, unknown> = {
    lastMessage: lastMessageText,
    lastMessageAt: now,
    channel: 'whatsapp',
  };

  const inc: Record<string, number> = {};

  if (direction === 'inbound') {
    update.status = 'open';
    update.lastInboundAt = now;
    inc.unreadCount = 1;
  } else {
    update.lastOutboundAt = now;
  }

  return await Conversation.findOneAndUpdate(
    { orgId, subscriberId },
    { 
      $set: update,
      ...(Object.keys(inc).length > 0 ? { $inc: inc } : {}),
      $setOnInsert: {
        status: 'open',
        priority: 'normal',
        unreadCount: 0,
        channel: 'whatsapp',
      }
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
};
