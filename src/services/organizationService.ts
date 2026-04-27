import Organization, { IOrganization } from '../models/Organization';
import Membership from '../models/Membership';
import AppError from '../utils/AppError';
import mongoose from 'mongoose';

export const createOrganization = async (
  name: string,
  userId: mongoose.Types.ObjectId
) => {
  // 1. Generate a simple slug (e.g., "Zaki's Gym" -> "zakis-gym")
  const slug = name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

  // 2. Check if slug is already taken
  const existingOrg = await Organization.findOne({ slug });
  if (existingOrg) {
    throw new AppError('An organization with this name already exists. Please try a different name.', 400);
  }

  // 3. Create the Organization
  const newOrg = await Organization.create({
    name,
    slug,
    planTier: 'basic', // Default plan as per your pricing
    subscriptionStatus: 'trialing',
  });

  // 4. Create the Membership (The creator is the Owner)
  await Membership.create({
    userId,
    orgId: newOrg._id,
    role: 'owner',
    status: 'active',
  });

  return newOrg;
};