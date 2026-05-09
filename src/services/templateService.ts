import axios from 'axios';
import mongoose from 'mongoose';
import { decrypt } from '../utils/encryption';
import WhatsAppTemplate from '../models/WhatsAppTemplate';

export const syncTemplatesFromMeta = async (org: any) => {
  const { wabaId, accessToken } = org.metaConfig;
  
  if (!wabaId || !accessToken) {
    throw new Error('Meta integration is incomplete. Missing WABA ID or Access Token.');
  }

  // 1. SECURITY: Decrypt the token to use it
  const decryptedToken = decrypt(accessToken);

  // 2. Fetch from Meta Graph API
  const response = await axios.get(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    params: { limit: 100 },
    headers: { Authorization: `Bearer ${decryptedToken}` }
  });

  const templates = response.data.data;

  // 3. SCALABILITY: Prepare bulk operations for MongoDB
  const operations = templates.map((tpl: any) => ({
    updateOne: {
      filter: { orgId: org._id, templateId: tpl.id },
      update: {
        $set: {
          wabaId: wabaId,
          name: tpl.name,
          language: tpl.language,
          category: tpl.category,
          status: tpl.status, // e.g., APPROVED, REJECTED
          components: tpl.components,
          rejectionReason: tpl.rejected_reason,
          lastSyncedAt: new Date()
        }
      },
      upsert: true
    }
  }));

  if (operations.length > 0) {
    await WhatsAppTemplate.bulkWrite(operations);
  }

  // 4. Update the organization's health metrics
  org.metaConfig.lastTemplateSyncAt = new Date();
  await org.save({ validateBeforeSave: false });

  return templates.length;
};