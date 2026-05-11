import Subscriber, { ISubscriber } from '../models/Subscriber';
import Organization from '../models/Organization';
import mongoose from 'mongoose';

interface UpsertSubscriberOptions {
  waId?: string;
  direction?: 'inbound' | 'outbound';
  optInSource?: string;
}

export const upsertSubscriber = async (
  orgId: mongoose.Types.ObjectId,
  phoneNumber: string,
  profileName?: string,
  options: UpsertSubscriberOptions = {}
): Promise<ISubscriber> => {
  let subscriber = await Subscriber.findOne({ orgId, phoneNumber });
  const interactionTime = new Date();

  if (subscriber) {
    subscriber.lastInteraction = interactionTime;
    if (!subscriber.firstName && profileName) {
      subscriber.firstName = profileName;
    }
    if (options.waId) {
      subscriber.waId = options.waId;
    }
    if (!subscriber.optInSource && options.optInSource) {
      subscriber.optInSource = options.optInSource;
    }
    if (options.direction === 'inbound') {
      subscriber.lastInboundAt = interactionTime;
    }
    if (options.direction === 'outbound') {
      subscriber.lastOutboundAt = interactionTime;
    }
    return await subscriber.save();
  }

  subscriber = await Subscriber.create({
    orgId,
    phoneNumber,
    waId: options.waId,
    firstName: profileName || 'WhatsApp User',
    isOptedIn: true,
    optInSource: options.optInSource || (options.direction === 'inbound' ? 'whatsapp_inbound' : 'manual'),
    lastInteraction: interactionTime,
    lastInboundAt: options.direction === 'inbound' ? interactionTime : undefined,
    lastOutboundAt: options.direction === 'outbound' ? interactionTime : undefined,
  });

  await Organization.findByIdAndUpdate(orgId, {
    $inc: { 'usage.subscribersCount': 1 }
  });

  return subscriber;
};
