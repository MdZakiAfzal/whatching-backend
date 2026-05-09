import { Response, NextFunction } from 'express';
import * as templateService from '../services/templateService';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import Organization from '../models/Organization';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { logIntegrationAction } from '../services/integrationLogService';

// POST /sync
export const syncTemplates = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  // We MUST explicitly select the accessToken because our model hides it by default
  const org = await Organization.findById(req.org._id).select('+metaConfig.accessToken');
  
  if (!org?.metaConfig?.wabaId || !org?.metaConfig?.accessToken) {
    return next(new AppError('Your Meta account is not fully connected yet.', 400));
  }

  try {
    const count = await templateService.syncTemplatesFromMeta(org);
    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_sync',
      status: 'success',
      details: { syncedCount: count },
    });

    res.status(200).json({
      status: 'success',
      message: `Successfully synced ${count} templates from Meta.`,
      data: { lastSyncedAt: org.metaConfig.lastTemplateSyncAt }
    });
  } catch (error: any) {
    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_sync',
      status: 'failed',
      details: { reason: error.message },
    });
    throw error;
  }
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

export const getTemplate = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const template = await WhatsAppTemplate.findOne({
    orgId: req.org._id,
    templateId: req.params.templateId,
  });

  if (!template) {
    return next(new AppError('Template not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { template },
  });
});

export const createTemplate = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const org = await Organization.findById(req.org._id).select('+metaConfig.accessToken');

  if (!org?.metaConfig?.wabaId || !org?.metaConfig?.accessToken) {
    return next(new AppError('Your Meta account is not fully connected yet.', 400));
  }

  try {
    const template = await templateService.createTemplateInMeta(org, req.body);
    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_create',
      status: 'success',
      details: {
        templateId: template.templateId,
        name: template.name,
        language: template.language,
        status: template.status,
      },
      externalRef: template.templateId,
    });

    res.status(201).json({
      status: 'success',
      data: { template },
    });
  } catch (error: any) {
    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_create',
      status: 'failed',
      details: {
        name: req.body.name,
        language: req.body.language,
        reason: error.message,
      },
    });
    throw error;
  }
});

export const deleteTemplate = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const org = await Organization.findById(req.org._id).select('+metaConfig.accessToken');

  if (!org?.metaConfig?.wabaId || !org?.metaConfig?.accessToken) {
    return next(new AppError('Your Meta account is not fully connected yet.', 400));
  }

  const template = await WhatsAppTemplate.findOne({
    orgId: req.org._id,
    templateId: req.params.templateId,
  });

  if (!template) {
    return next(new AppError('Template not found for this organization.', 404));
  }

  try {
    await templateService.deleteTemplateInMeta(org, template);
    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_delete',
      status: 'success',
      details: {
        templateId: template.templateId,
        name: template.name,
      },
      externalRef: template.templateId,
    });

    res.status(200).json({
      status: 'success',
      message: 'Template deleted successfully.',
    });
  } catch (error: any) {
    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_delete',
      status: 'failed',
      details: {
        templateId: template.templateId,
        name: template.name,
        reason: error.message,
      },
      externalRef: template.templateId,
    });
    throw error;
  }
});
