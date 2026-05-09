import { Response, NextFunction } from 'express';
import * as templateService from '../services/templateService';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import Organization from '../models/Organization';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';

// POST /sync
export const syncTemplates = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  // We MUST explicitly select the accessToken because our model hides it by default
  const org = await Organization.findById(req.org._id).select('+metaConfig.accessToken');
  
  if (!org?.metaConfig?.wabaId || !org?.metaConfig?.accessToken) {
    return next(new AppError('Your Meta account is not fully connected yet.', 400));
  }

  const count = await templateService.syncTemplatesFromMeta(org);

  res.status(200).json({
    status: 'success',
    message: `Successfully synced ${count} templates from Meta.`,
    data: { lastSyncedAt: org.metaConfig.lastTemplateSyncAt }
  });
});

// GET /
export const getTemplates = catchAsync(async (req: any, res: Response) => {
  const templates = await WhatsAppTemplate.find({ orgId: req.org._id }).sort('-updatedAt');
  
  res.status(200).json({
    status: 'success',
    results: templates.length,
    data: { templates }
  });
});