import { Response, NextFunction } from 'express';
import Membership from '../models/Membership';
import AppError from '../utils/AppError';
import catchAsync from '../utils/catchAsync';

export const restrictTo = (...roles: string[]) => {
  return catchAsync(async (req: any, res: Response, next: NextFunction) => {
    const membership = await Membership.findOne({
      userId: req.user._id,
      orgId: req.org._id
    });

    if (!membership || !roles.includes(membership.role)) {
      return next(new AppError('You do not have permission for this action.', 403));
    }

    next();
  });
};