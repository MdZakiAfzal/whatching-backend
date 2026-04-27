import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken'; 
import crypto from 'crypto'; 
import { promisify } from 'util'; 
import * as authService from '../services/authService';
import User from '../models/User';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { config } from '../config';
import Email from '../utils/Email';

const createSendToken = (user: any, statusCode: number, res: Response) => {
  const accessToken = authService.signToken(user._id, config.jwtSecret, '15m');
  const refreshToken = authService.signToken(user._id, config.jwtSecret, '7d');

  res.cookie('refreshToken', refreshToken, {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
  });

  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token: accessToken,
    data: { user }
  });
};

export const signup = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { user } = await authService.registerUser(req.body);
  
  // Generate verification token
  const verificationToken = crypto.randomBytes(32).toString('hex');
  user.verificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
  await user.save({ validateBeforeSave: false });

  // In production, this URL points to your frontend (e.g., app.whatching.com/verify)
  const verificationURL = `${req.protocol}://${req.get('host')}/api/v1/users/verify/${verificationToken}`;
  
  try {
    await new Email(user, verificationURL).sendVerification();
    res.status(201).json({
      status: 'success',
      message: 'Verification link sent to email!'
    });
  } catch (err) {
    user.verificationToken = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError('Error sending verification email. Please try again later.', 500));
  }
});

// 2. VERIFY EMAIL: Confirm the token and activate account
export const verifyEmail = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const hashedToken = crypto.createHash('sha256').update(req.params.token as string).digest('hex');

  const user = await User.findOne({ verificationToken: hashedToken });
  if (!user) {
    return next(new AppError('Token is invalid or has expired.', 400));
  }

  user.isVerified = true;
  user.verificationToken = undefined;
  await user.save({ validateBeforeSave: false });

  // Log them in immediately after verification
  createSendToken(user, 200, res);
});

export const login = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  createSendToken(user, 200, res);
});

export const logout = (req: Request, res: Response) => {
  res.cookie('refreshToken', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ status: 'success' });
};

export const refreshToken = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies.refreshToken;

  if (!token) {
    return next(new AppError('No refresh token found. Please log in again.', 401));
  }

  // Use promisify to avoid callback hell
  const decoded: any = await (promisify(jwt.verify) as any)(token, config.jwtSecret);

  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(new AppError('User no longer exists.', 401));
  }

  const accessToken = authService.signToken(currentUser._id.toString(), config.jwtSecret, '15m');

  res.status(200).json({
    status: 'success',
    token: accessToken
  });
});

export const forgotPassword = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) return next(new AppError('No user found with that email.', 404));

  const resetToken = (user as any).createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/reset-password/${resetToken}`;

  try {
    await new Email(user, resetURL).sendPasswordReset();
    res.status(200).json({ status: 'success', message: 'Token sent to email!' });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError('Error sending reset email.', 500));
  }
});

export const resetPassword = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token as string)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() } 
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired.', 400));
  }

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  
  await user.save();
  createSendToken(user, 200, res);
});

export const getMe = (req: any, res: Response) => {
  res.status(200).json({
    status: 'success',
    data: { user: req.user }
  });
};