import Subscriber, { ISubscriber } from '../models/Subscriber';
import mongoose from 'mongoose';

export const upsertSubscriber = async (
  orgId: mongoose.Types.ObjectId,
  phoneNumber: string,
  profileName?: string
): Promise<ISubscriber> => {
  // We use profileName as a fallback for firstName if the subscriber is new
  return await Subscriber.findOneAndUpdate(
    { orgId, phoneNumber },
    { 
      $set: { lastInteraction: new Date() },
      $setOnInsert: { 
        firstName: profileName || 'WhatsApp User',
        isOptedIn: true 
      } 
    },
    { upsert: true, new: true, runValidators: true }
  );
};