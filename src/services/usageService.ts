import mongoose from 'mongoose';
import Organization from '../models/Organization';

export const trackMessagingUsage = async (
  orgId: mongoose.Types.ObjectId | string,
  counter: 'templateMessagesSent' | 'sessionMessagesSent'
) => {
  try {
    await Organization.findByIdAndUpdate(orgId, {
      $inc: { [`usage.${counter}`]: 1 },
      $set: { 'usage.lastMessageAt': new Date() },
    });
  } catch (error) {
    console.error(`Usage tracking failed for org ${String(orgId)}:`, error);
  }
};
