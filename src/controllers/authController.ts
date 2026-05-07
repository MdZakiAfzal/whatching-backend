import { Request, Response, NextFunction, CookieOptions } from 'express';
import jwt from 'jsonwebtoken'; 
import crypto from 'crypto'; 
import { promisify } from 'util'; 
import * as authService from '../services/authService';
import User from '../models/User';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { config } from '../config';
import Email from '../utils/Email';

const dispatchEmail = (label: string, task: Promise<void>) => {
  void task.catch((error) => {
    console.error(`${label} failed`, error);
  });
};

const createSendToken = async (user: any, statusCode: number, res: Response) => {
  const accessToken = authService.signToken(user._id, config.jwtSecret, '15m');
  const refreshToken = authService.signToken(user._id, config.jwtSecret, '7d');
  const refreshCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
  };

  // ROTATION: Save the new refresh token to the database
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  res.cookie('refreshToken', refreshToken, {
    ...refreshCookieOptions,
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  user.password = undefined;
  user.refreshToken = undefined;
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

  res.status(201).json({
    status: 'success',
    message: 'Account created. Verification email is being sent.'
  });

  dispatchEmail('Signup verification email', new Email(user, verificationURL).sendVerification());
});

export const resendVerification = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) return next(new AppError('No user found with that email.', 404));
  if (user.isVerified) return next(new AppError('Account is already verified.', 400));

  const verificationToken = crypto.randomBytes(32).toString('hex');
  user.verificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
  await user.save({ validateBeforeSave: false });

  const verificationURL = `${req.protocol}://${req.get('host')}/api/v1/users/verify/${verificationToken}`;

  res.status(200).json({ status: 'success', message: 'Verification email is being sent.' });

  dispatchEmail('Resend verification email', new Email(user, verificationURL).sendVerification());
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
  await createSendToken(user, 200, res);
});

export const login = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }

  if (!user.isVerified) {
    return next(new AppError('Please verify your email to log in.', 401));
  }

  await createSendToken(user, 200, res);
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies.refreshToken;
  const refreshCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
  };

  if (token) {
    try {
      const decoded: any = await (promisify(jwt.verify) as any)(token, config.jwtSecret);
      const currentUser = await User.findById(decoded.id).select('+refreshToken');

      if (currentUser && currentUser.refreshToken === token) {
        currentUser.refreshToken = undefined;
        await currentUser.save({ validateBeforeSave: false });
      }
    } catch {
      // Expired or invalid cookies can still be cleared client-side.
    }
  }

  res.cookie('refreshToken', '', {
    ...refreshCookieOptions,
    expires: new Date(0),
  });
  res.status(200).json({ status: 'success' });
});

export const refreshToken = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies.refreshToken;
  if (!token) return next(new AppError('No refresh token found. Please login again.', 401));

  const decoded: any = await (promisify(jwt.verify) as any)(token, config.jwtSecret);

  // Verification: Ensure the token in the cookie matches the one in our DB
  const currentUser = await User.findById(decoded.id).select('+refreshToken');
  
  if (!currentUser || currentUser.refreshToken !== token) {
    // If it doesn't match, revoke the token to prevent reuse attacks
    if (currentUser) {
      currentUser.refreshToken = undefined;
      await currentUser.save({ validateBeforeSave: false });
    }
    return next(new AppError('Invalid refresh token. Please log in again.', 401));
  }

  // Issue a brand new pair of tokens
  await createSendToken(currentUser, 200, res);
});

export const forgotPassword = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) return next(new AppError('No user found with that email.', 404));

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/reset-password/${resetToken}`;
  res.status(200).json({ status: 'success', message: 'Password reset email is being sent.' });

  dispatchEmail('Password reset email', new Email(user, resetURL).sendPasswordReset());
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
  await createSendToken(user, 200, res);
});

export const getMe = (req: any, res: Response) => {
  res.status(200).json({
    status: 'success',
    data: { user: req.user }
  });
};
