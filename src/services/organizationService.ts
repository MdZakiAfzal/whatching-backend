import Organization from '../models/Organization';
import Membership from '../models/Membership';
import mongoose from 'mongoose';

export const createOrganization = async (name: string, userId: mongoose.Types.ObjectId) => {
  // 1. Generate a unique slug (Name + 4 random characters)
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  const slug = `${name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '')}-${randomSuffix}`;

  // 2. Create the "Shell" Organization
  const newOrg = await Organization.create({
    name,
    slug,
    planTier: 'none',
    subscriptionStatus: 'pending_payment',
  });

  // 3. Automatically make the creator the OWNER
  await Membership.create({
    userId,
    orgId: newOrg._id,
    role: 'owner',
    status: 'active',
  });

  return newOrg;
};