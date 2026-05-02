import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Membership from '../models/Membership';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';
import { PlanManager } from '../utils/planManager';
import { PLANS } from '../config/planConfig';

// 1. ADD AGENT (Managed Account Model)
export const addAgent = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { name, email, password, phoneNumber } = req.body;
  const organization = req.org;

  // 1. Plan Enforcement: Count ONLY agents in this organization
  const plan = new PlanManager(organization);
  const currentAgentCount = await Membership.countDocuments({ 
    orgId: organization._id, 
    role: 'agent' 
  });

  if (!plan.isUnderLimit('agents', currentAgentCount)) {
    const allowed = PLANS[organization.planTier].maxAgents;
    return next(new AppError(
      `Limit reached. Your ${organization.planTier} plan allows a maximum of ${allowed} agent seats.`, 
      402
    ));
  }

  // 2. CHECK: Does this user already have an account in Whatching?
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    // Check if they are already part of THIS specific organization
    const alreadyMember = await Membership.findOne({
      userId: existingUser._id,
      orgId: organization._id
    });

    if (alreadyMember) {
      return next(new AppError('This user is already a member of your team.', 400));
    }

    // SUCCESS SCENARIO A: Link existing user to this organization
    await Membership.create({
      userId: existingUser._id,
      orgId: organization._id,
      role: 'agent',
      status: 'active'
    });

    return res.status(200).json({
      status: 'success',
      message: 'Existing user added to your organization as an agent.'
    });
  }

  // 3. SUCCESS SCENARIO B: Create brand new User + Membership (Atomic Transaction)
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const newAgent = await User.create([{
      name,
      email,
      password,
      phoneNumber, // Required by your updated User model
      isVerified: true // Owners verify their own staff
    }], { session });

    await Membership.create([{
      userId: newAgent[0]._id,
      orgId: organization._id,
      role: 'agent',
      status: 'active'
    }], { session });

    await session.commitTransaction();
    
    res.status(201).json({
      status: 'success',
      data: {
        agent: { id: newAgent[0]._id, name, phoneNumber, email }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// 2. GET TEAM (List everyone in the business)
export const getTeam = catchAsync(async (req: any, res: Response) => {
  const team = await Membership.find({ orgId: req.org._id })
    .populate('userId', 'name email');

  res.status(200).json({
    status: 'success',
    results: team.length,
    data: { team }
  });
});

// 3. REMOVE MEMBER (Revoke access)
export const removeMember = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { membershipId } = req.params;

  const membership = await Membership.findOne({
    _id: membershipId,
    orgId: req.org._id
  });

  if (!membership) return next(new AppError('Team member not found.', 404));
  
  // SECURITY: Protection for the owner
  if (membership.role === 'owner') {
    return next(new AppError('The organization owner cannot be removed.', 400));
  }

  await Membership.findByIdAndDelete(membershipId);

  res.status(204).json({
    status: 'success',
    data: null
  });
});