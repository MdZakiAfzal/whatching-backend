import { Response, NextFunction } from 'express';
import * as templateService from '../services/templateService';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import Organization from '../models/Organization';
import TemplateDraft from '../models/TemplateDraft';
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

export const getTemplateDrafts = catchAsync(async (req: any, res: Response) => {
  const drafts = await TemplateDraft.find({
    orgId: req.org._id,
    status: { $nin: ['approved', 'deleted'] },
  })
    .sort({ updatedAt: -1 })
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');

  res.status(200).json({
    status: 'success',
    results: drafts.length,
    data: { drafts },
  });
});

export const getTemplateDraft = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const draft = await TemplateDraft.findOne({
    _id: req.params.draftId,
    orgId: req.org._id,
  })
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');

  if (!draft) {
    return next(new AppError('Template draft not found for this organization.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { draft },
  });
});

export const createTemplateDraft = catchAsync(async (req: any, res: Response) => {
  await templateService.ensureTemplateDraftNameAvailability({
    orgId: String(req.org._id),
    name: req.body.name,
  });

  const draft = await TemplateDraft.create({
    orgId: req.org._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
    name: req.body.name,
    language: req.body.language,
    category: req.body.category,
    components: req.body.components,
    allowCategoryChange: req.body.allowCategoryChange,
  });

  await logIntegrationAction({
    orgId: req.org._id,
    actorUserId: req.user._id,
    action: 'template_draft_create',
    status: 'success',
    details: {
      draftId: String(draft._id),
      name: draft.name,
      language: draft.language,
    },
    externalRef: String(draft._id),
  });

  res.status(201).json({
    status: 'success',
    data: { draft },
  });
});

export const updateTemplateDraft = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const draft = await TemplateDraft.findOne({
    _id: req.params.draftId,
    orgId: req.org._id,
  });

  if (!draft) {
    return next(new AppError('Template draft not found for this organization.', 404));
  }

  if (!['draft', 'rejected', 'disabled'].includes(draft.status)) {
    return next(new AppError(`Template drafts in status ${draft.status} cannot be edited.`, 409));
  }

  await templateService.ensureTemplateDraftNameAvailability({
    orgId: String(req.org._id),
    name: req.body.name ?? draft.name,
    excludeDraftId: String(draft._id),
    linkedMetaTemplateId: draft.metaTemplateId,
  });

  Object.assign(draft, {
    ...req.body,
    updatedBy: req.user._id,
    status: 'draft',
    rejectionReason: undefined,
  });
  await draft.save();

  res.status(200).json({
    status: 'success',
    data: { draft },
  });
});

export const deleteTemplateDraft = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const draft = await TemplateDraft.findOne({
    _id: req.params.draftId,
    orgId: req.org._id,
  });

  if (!draft) {
    return next(new AppError('Template draft not found for this organization.', 404));
  }

  if (!['draft', 'rejected', 'disabled'].includes(draft.status)) {
    return next(new AppError(`Template drafts in status ${draft.status} cannot be deleted.`, 409));
  }

  await TemplateDraft.deleteOne({ _id: draft._id, orgId: req.org._id });

  await logIntegrationAction({
    orgId: req.org._id,
    actorUserId: req.user._id,
    action: 'template_draft_delete',
    status: 'success',
    details: {
      draftId: String(draft._id),
      name: draft.name,
      language: draft.language,
    },
    externalRef: String(draft._id),
  });

  res.status(200).json({
    status: 'success',
    message: 'Template draft deleted successfully.',
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
    await templateService.ensureTemplateDraftNameAvailability({
      orgId: String(req.org._id),
      name: req.body.name,
    });

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

export const submitTemplateDraft = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const org = await Organization.findById(req.org._id).select('+metaConfig.accessToken');

  if (!org?.metaConfig?.wabaId || !org?.metaConfig?.accessToken) {
    return next(new AppError('Your Meta account is not fully connected yet.', 400));
  }

  const draft = await TemplateDraft.findOne({
    _id: req.params.draftId,
    orgId: req.org._id,
  });

  if (!draft) {
    return next(new AppError('Template draft not found for this organization.', 404));
  }

  if (!['draft', 'rejected', 'disabled'].includes(draft.status)) {
    return next(new AppError(`Template drafts in status ${draft.status} cannot be submitted.`, 409));
  }

  await templateService.ensureTemplateDraftNameAvailability({
    orgId: String(req.org._id),
    name: draft.name,
    excludeDraftId: String(draft._id),
    linkedMetaTemplateId: draft.metaTemplateId,
  });

  draft.status = 'submitted';
  draft.updatedBy = req.user._id;
  draft.lastSubmittedAt = new Date();
  draft.rejectionReason = undefined;
  await draft.save();

  try {
    const template = await templateService.submitTemplateDraftToMeta(org, draft);

    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_draft_submit',
      status: 'success',
      details: {
        draftId: String(draft._id),
        templateId: template.templateId,
        status: template.status,
      },
      externalRef: String(draft._id),
    });

    res.status(200).json({
      status: 'success',
      data: {
        draft,
        template,
      },
    });
  } catch (error: any) {
    draft.status = 'draft';
    draft.updatedBy = req.user._id;
    draft.rejectionReason = error.message;
    await draft.save();

    await logIntegrationAction({
      orgId: req.org._id,
      actorUserId: req.user._id,
      action: 'template_draft_submit',
      status: 'failed',
      details: {
        draftId: String(draft._id),
        reason: error.message,
      },
      externalRef: String(draft._id),
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
