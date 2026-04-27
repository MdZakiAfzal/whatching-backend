import { Request, Response, NextFunction } from 'express';
import * as orgService from '../services/organizationService';
import catchAsync from '../utils/catchAsync';
import mongoose from 'mongoose';
import AppError from '../utils/AppError';

export const setupOrganization = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { name } = req.body;
    
    // NOTE: In a real flow, req.user.id will come from your Auth Middleware.
    // For now, we expect it in the body to test the logic.
    const { userId } = req.body;

    if (!name || !userId) {
      return next(new AppError('Organization name and User ID are required', 400));
    }

    const organization = await orgService.createOrganization(
      name, 
      new mongoose.Types.ObjectId(userId)
    );

    res.status(201).json({
      status: 'success',
      data: {
        organization,
      },
    });
  }
);