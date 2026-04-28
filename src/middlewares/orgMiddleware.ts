import { Request, Response, NextFunction } from 'express';
import Membership from '../models/Membership';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';

export const setOrgContext = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  // 1. Get Org ID from header
  const orgId = req.headers['x-org-id'];

  if (!orgId) {
    return next(new AppError('Please select an organization to continue.', 400));
  }

  // 2. Check if user is a member of this organization
  const membership = await Membership.findOne({
    userId: req.user._id,
    orgId: orgId,
    status: 'active'
  }).populate('orgId');

  if (!membership) {
    return next(new AppError('You do not have access to this organization.', 403));
  }

  // 3. Attach the organization data to the request object
  // Now, every controller after this has access to req.org
  req.org = membership.orgId; 
  
  next();
});