import { Request, Response, NextFunction } from 'express';
import * as orgService from '../services/organizationService';
import Organization from '../models/Organization';
import Membership from '../models/Membership';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { encrypt } from '../utils/encryption';
import * as whatsappService from '../services/whatsappService';

// STAGE 1: Create the basic business identity
export const setupOrganization = catchAsync(async (req: any, res: Response) => {
  const { name } = req.body;

  if (!name) throw new AppError('Business name is required', 400);
    
  const organization = await orgService.createOrganization(name, req.user._id);

  res.status(201).json({
    status: 'success',
    data: { organization },
  });
});

// STAGE 2: Link Meta credentials after Embedded Signup
export const connectMeta = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { wabaId, phoneNumberId, code } = req.body;
  const orgId = req.org._id;

  // Security: Ensure only the OWNER can connect Meta
  const membership = await Membership.findOne({ 
    userId: req.user._id, 
    orgId, 
    role: 'owner' 
  });
  
  if (!membership) {
    return next(new AppError('You do not have permission to manage this business.', 403));
  }

  const permanentToken = await whatsappService.exchangeCodeForToken(code);
  const encryptedToken = encrypt(permanentToken);
  
  const organization = await Organization.findByIdAndUpdate(
    orgId,
    {
      'metaConfig.wabaId': wabaId,
      'metaConfig.phoneNumberId': phoneNumberId,
      'metaConfig.accessToken': encryptedToken,
    },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    status: 'success',
    data: { organization }
  });
});

export const getMyOrganizations = catchAsync(async (req: any, res: Response) => {
  // Find all memberships for this user and populate the full Organization details
  const memberships = await Membership.find({ userId: req.user._id, status: 'active' })
    .populate('orgId');

  // Extract only the organization documents
  const organizations = memberships.map(m => m.orgId);

  res.status(200).json({
    status: 'success',
    results: organizations.length,
    data: { organizations }
  });
});

export const getOrganization = catchAsync(async (req: any, res: Response) => {
  // req.org is populated by the setOrgContext middleware
  res.status(200).json({
    status: 'success',
    data: { 
      organization: req.org 
    }
  });
});