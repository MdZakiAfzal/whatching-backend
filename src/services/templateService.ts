import axios from 'axios';
import { decrypt } from '../utils/encryption';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import AppError from '../utils/AppError';
import TemplateDraft from '../models/TemplateDraft';

const GRAPH_API_VERSION = 'v20.0';

const buildMetaHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${decrypt(accessToken)}`,
});

const normalizeTemplateStatus = (status?: string) => status?.trim().toUpperCase() || 'PENDING';

const normalizeTemplateCategory = (category?: string) => category?.trim().toUpperCase() || 'UTILITY';
const buildExactCaseInsensitiveNameRegex = (name: string) =>
  new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

export const mapTemplateStatusToDraftStatus = (status?: string) => {
  const normalized = normalizeTemplateStatus(status);

  if (normalized === 'APPROVED' || normalized === 'REINSTATED') return 'approved';
  if (normalized === 'REJECTED') return 'rejected';
  if (normalized === 'DISABLED' || normalized === 'DELETED' || normalized === 'PENDING_DELETION') return 'disabled';
  if (normalized === 'SUBMITTED') return 'submitted';

  return 'pending_review';
};

const syncDraftFromTemplate = async (orgId: any, template: any) => {
  if (!template?.templateId) {
    return;
  }

  await TemplateDraft.findOneAndUpdate(
    {
      orgId,
      $or: [
        { metaTemplateId: template.templateId },
        { name: template.name, language: template.language },
      ],
    },
    {
      $set: {
        metaTemplateId: template.templateId,
        status: mapTemplateStatusToDraftStatus(template.status),
        rejectionReason: template.rejectionReason,
      },
    }
  );
};

export const ensureTemplateDraftNameAvailability = async ({
  orgId,
  name,
  excludeDraftId,
  linkedMetaTemplateId,
}: {
  orgId: string;
  name: string;
  excludeDraftId?: string;
  linkedMetaTemplateId?: string;
}) => {
  const normalizedNameRegex = buildExactCaseInsensitiveNameRegex(name);

  const [matchingTemplate, matchingDraft] = await Promise.all([
    WhatsAppTemplate.findOne({
      orgId,
      name: normalizedNameRegex,
      status: { $ne: 'ARCHIVED' },
      ...(linkedMetaTemplateId
        ? {
            templateId: { $ne: linkedMetaTemplateId },
          }
        : {}),
    }).select('templateId name language status'),
    TemplateDraft.findOne({
      orgId,
      name: normalizedNameRegex,
      status: { $nin: ['deleted', 'approved'] },
      ...(excludeDraftId
        ? {
            _id: { $ne: excludeDraftId },
          }
        : {}),
    }).select('_id name language status'),
  ]);

  if (matchingTemplate) {
    throw new AppError(
      `A Meta template named '${matchingTemplate.name}' already exists in this organization. Please use a different template name.`,
      409
    );
  }

  if (matchingDraft) {
    throw new AppError(
      `A template draft named '${matchingDraft.name}' already exists in this organization. Please use a different template name.`,
      409
    );
  }
};

export const syncTemplatesFromMeta = async (org: any) => {
  const { wabaId, accessToken } = org.metaConfig;
  
  if (!wabaId || !accessToken) {
    throw new Error('Meta integration is incomplete. Missing WABA ID or Access Token.');
  }

  const response = await axios.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    params: { limit: 100 },
    headers: buildMetaHeaders(accessToken),
  });

  const templates = response.data.data ?? [];
  const activeTemplateIds = templates.map((tpl: any) => tpl.id).filter(Boolean);

  const operations = templates.map((tpl: any) => ({
    updateOne: {
      filter: { orgId: org._id, templateId: tpl.id },
      update: {
        $set: {
          wabaId: wabaId,
          templateId: tpl.id,
          name: tpl.name,
          language: tpl.language,
          category: normalizeTemplateCategory(tpl.category),
          status: normalizeTemplateStatus(tpl.status),
          components: tpl.components ?? [],
          rejectionReason: tpl.rejected_reason,
          qualityScore: tpl.quality_score ?? tpl.quality_rating,
          namespace: tpl.namespace,
          lastSyncedAt: new Date(),
        }
      },
      upsert: true
    }
  }));

  if (operations.length > 0) {
    await WhatsAppTemplate.bulkWrite(operations);
  }

  const syncedTemplates = await WhatsAppTemplate.find({
    orgId: org._id,
    templateId: { $in: activeTemplateIds },
  }).select('templateId name language status rejectionReason');

  for (const template of syncedTemplates) {
    await syncDraftFromTemplate(org._id, template);
  }

  await WhatsAppTemplate.updateMany(
    {
      orgId: org._id,
      templateId: { $nin: activeTemplateIds },
    },
    {
      $set: {
        status: 'ARCHIVED',
        lastSyncedAt: new Date(),
      },
    }
  );

  org.metaConfig.lastTemplateSyncAt = new Date();
  org.metaConfig.lastHealthCheckAt = new Date();
  await org.save({ validateBeforeSave: false });

  return templates.length;
};

export const createTemplateInMeta = async (
  org: any,
  payload: {
    name: string;
    language: string;
    category: string;
    components: Record<string, unknown>[];
    allowCategoryChange?: boolean;
  }
) => {
  const { wabaId, accessToken } = org.metaConfig;

  if (!wabaId || !accessToken) {
    throw new AppError('Meta integration is incomplete. Missing WABA ID or access token.', 400);
  }

  try {
    // 1. Wrap the Axios call in a try/catch
    await axios.post(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`,
      {
        name: payload.name,
        language: payload.language,
        category: normalizeTemplateCategory(payload.category),
        components: payload.components,
        allow_category_change: payload.allowCategoryChange,
      },
      {
        headers: {
          ...buildMetaHeaders(accessToken),
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    // 2. Extract Meta's deeply nested error details
    const metaError = error.response?.data?.error;
    if (metaError) {
      // Meta puts the human-readable reason in one of these three fields depending on the error type
      const detailMessage = metaError.error_user_msg || metaError.error_data?.details || metaError.message;
      throw new AppError(`Meta Template Error: ${detailMessage}`, 400);
    }
    // Fallback if it's a network timeout
    throw new AppError('Failed to create template in Meta. Provider did not respond.', 502);
  }

  await syncTemplatesFromMeta(org);

  const template = await WhatsAppTemplate.findOne({
    orgId: org._id,
    name: payload.name,
    language: payload.language,
  }).sort('-updatedAt');

  if (!template) {
    throw new AppError('Template was created in Meta but could not be found locally after sync.', 502);
  }

  return template;
};

const cleanupLinkedMetaTemplateBeforeResubmission = async (org: any, draft: any) => {
  if (!draft.metaTemplateId) {
    return;
  }

  const linkedTemplate = await WhatsAppTemplate.findOne({
    orgId: org._id,
    templateId: draft.metaTemplateId,
  });

  if (!linkedTemplate || !['REJECTED', 'DISABLED', 'PENDING_DELETION'].includes(linkedTemplate.status)) {
    return;
  }

  try {
    await axios.delete(`https://graph.facebook.com/${GRAPH_API_VERSION}/${org.metaConfig.wabaId}/message_templates`, {
      headers: buildMetaHeaders(org.metaConfig.accessToken),
      params: {
        name: linkedTemplate.name,
        hsm_id: linkedTemplate.templateId,
      },
    });
  } catch (error: any) {
    const metaError = error.response?.data?.error;
    const detailMessage = metaError?.error_user_msg || metaError?.error_data?.details || metaError?.message;
    throw new AppError(
      detailMessage ||
        'The previously rejected Meta template could not be replaced. Rename the draft or try syncing templates again.',
      409
    );
  }

  await WhatsAppTemplate.deleteOne({ _id: linkedTemplate._id });
  draft.metaTemplateId = undefined;
};

export const submitTemplateDraftToMeta = async (org: any, draft: any) => {
  await cleanupLinkedMetaTemplateBeforeResubmission(org, draft);

  const template = await createTemplateInMeta(org, {
    name: draft.name,
    language: draft.language,
    category: draft.category,
    components: draft.components,
    allowCategoryChange: draft.allowCategoryChange,
  });

  draft.metaTemplateId = template.templateId;
  draft.status = mapTemplateStatusToDraftStatus(template.status);
  draft.rejectionReason = template.rejectionReason;
  draft.lastSubmittedAt = new Date();
  await draft.save();

  return template;
};

export const applyTemplateStatusWebhook = async ({
  orgId,
  wabaId,
  value,
}: {
  orgId?: string;
  wabaId?: string;
  value: any;
}) => {
  const templateId = value?.message_template_id ? String(value.message_template_id) : undefined;
  const templateName = value?.message_template_name ? String(value.message_template_name) : undefined;
  const language = value?.message_template_language ? String(value.message_template_language).trim() : undefined;
  const event = normalizeTemplateStatus(value?.event);
  const rejectionReason = value?.reason || value?.rejection_reason || undefined;

  const filter: Record<string, unknown> = {
    ...(orgId ? { orgId } : {}),
    ...(wabaId ? { wabaId } : {}),
  };

  if (!templateId && !(templateName && language)) {
    return null;
  }

  if (templateId) {
    filter.templateId = templateId;
  } else if (templateName && language) {
    filter.name = templateName;
    filter.language = language;
  }

  const template = await WhatsAppTemplate.findOneAndUpdate(
    filter,
    {
      $set: {
        ...(wabaId ? { wabaId } : {}),
        ...(templateId ? { templateId } : {}),
        ...(templateName ? { name: templateName } : {}),
        ...(language ? { language } : {}),
        status: event,
        rejectionReason,
        lastSyncedAt: new Date(),
      },
    },
    {
      upsert: false,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: false,
    }
  );

  if (orgId) {
    await TemplateDraft.findOneAndUpdate(
      {
        orgId,
        $or: [
          ...(templateId ? [{ metaTemplateId: templateId }] : []),
          ...(templateName && language ? [{ name: templateName, language }] : []),
        ],
      },
      {
        $set: {
          ...(templateId ? { metaTemplateId: templateId } : {}),
          status: mapTemplateStatusToDraftStatus(event),
          rejectionReason,
        },
      }
    );
  }

  return template;
};

export const deleteTemplateInMeta = async (org: any, template: any) => {
  const { wabaId, accessToken } = org.metaConfig;

  if (!wabaId || !accessToken) {
    throw new AppError('Meta integration is incomplete. Missing WABA ID or access token.', 400);
  }

  await axios.delete(`https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates`, {
    headers: buildMetaHeaders(accessToken),
    params: {
      name: template.name,
      hsm_id: template.templateId,
    },
  });

  await WhatsAppTemplate.deleteOne({ _id: template._id });
};
