import axios from 'axios';
import { decrypt } from '../utils/encryption';
import WhatsAppTemplate from '../models/WhatsAppTemplate';
import AppError from '../utils/AppError';

const GRAPH_API_VERSION = 'v20.0';

const buildMetaHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${decrypt(accessToken)}`,
});

const normalizeTemplateStatus = (status?: string) => status?.trim().toUpperCase() || 'PENDING';

const normalizeTemplateCategory = (category?: string) => category?.trim().toUpperCase() || 'UTILITY';

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

  const activeTemplateIds = templates.map((tpl: any) => tpl.id).filter(Boolean);
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
