import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import User from '../models/User';
import { config } from '../config';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

export const protect = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  // 1. Get token and check if it exists
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }

  // 2. Verification of token
  const decoded: any = await (promisify(jwt.verify) as any)(token, config.jwtSecret);

  // 3. Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(new AppError('The user belonging to this token no longer exists.', 401));
  }

  // 4. Check if user changed password after the token was issued
  if (currentUser.passwordChangedAt) {
    const changedTimestamp = Math.floor(currentUser.passwordChangedAt.getTime() / 1000);
    if (decoded.iat < changedTimestamp) {
      return next(new AppError('User recently changed password! Please log in again.', 401));
    }
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  next();
});