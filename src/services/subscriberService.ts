import Subscriber, { ISubscriber } from '../models/Subscriber';
import Organization from '../models/Organization';
import mongoose from 'mongoose';

export const upsertSubscriber = async (
  orgId: mongoose.Types.ObjectId,
  phoneNumber: string,
  profileName?: string
): Promise<ISubscriber> => {
  // 1. Check if the subscriber already exists
  let subscriber = await Subscriber.findOne({ orgId, phoneNumber });

  if (subscriber) {
    // If they exist, just update their last interaction time
    // and grab their name if we didn't have it before
    subscriber.lastInteraction = new Date();
    if (!subscriber.firstName && profileName) {
      subscriber.firstName = profileName;
    }
    return await subscriber.save();
  }

  // 2. Create New Subscriber (No hard blocking limits here)
  // We allow the creation so the bot can reply, but we enforce limits on Broadcasts later.
  subscriber = await Subscriber.create({
    orgId,
    phoneNumber,
    firstName: profileName || 'WhatsApp User',
    isOptedIn: true,
    lastInteraction: new Date()
  });

  // 3. Update Org Usage Counter for the Upsell Lock
  await Organization.findByIdAndUpdate(orgId, {
    $inc: { 'usage.subscribersCount': 1 }
  });

  return subscriber;
};