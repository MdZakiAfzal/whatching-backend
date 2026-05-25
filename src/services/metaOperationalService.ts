import axios from 'axios';
import { decrypt } from '../utils/encryption';
import Organization from '../models/Organization';

const GRAPH_API_VERSION = 'v20.0';

type AlertSeverity = 'info' | 'warning' | 'critical';

const buildMetaHeaders = (encryptedAccessToken: string) => ({
  Authorization: `Bearer ${decrypt(encryptedAccessToken)}`,
});

const normalizeTierLimit = (tier?: string | null) => {
  if (!tier) return null;
  const normalized = String(tier).trim().toUpperCase();
  return normalized || null;
};

const limitTierToCount = (tier?: string | null) => {
  const normalized = normalizeTierLimit(tier);
  if (!normalized) return null;

  // 1. Handle "Unlimited" cases
  if (normalized === 'UNLIMITED' || normalized === 'TIER_UNLIMITED') {
    return Number.MAX_SAFE_INTEGER;
  }

  // 2. Dynamically parse Meta's raw numerical strings (e.g., "250", "2000", "10000")
  const numericValue = parseInt(normalized, 10);
  if (!isNaN(numericValue) && numericValue > 0) {
    return numericValue;
  }

  return null;
};

const upsertAlert = (
  alerts: any[],
  {
    code,
    severity,
    message,
    active,
  }: { code: string; severity: AlertSeverity; message: string; active: boolean }
) => {
  const existing = alerts.find((alert) => alert.code === code);

  if (active) {
    if (existing) {
      existing.severity = severity;
      existing.message = message;
      existing.lastTriggeredAt = new Date();
      return alerts;
    }

    alerts.push({
      code,
      severity,
      message,
      createdAt: new Date(),
      lastTriggeredAt: new Date(),
    });
    return alerts;
  }

  return alerts.filter((alert) => alert.code !== code);
};

const applyQualityAlerts = (organization: any, event?: string | null, currentLimit?: string | null) => {
  const normalizedEvent = event ? String(event).trim().toUpperCase() : '';
  let alerts = Array.isArray(organization.metaConfig?.activeAlerts)
    ? organization.metaConfig.activeAlerts.map((alert: any) => ({ ...alert }))
    : [];

  alerts = upsertAlert(alerts, {
    code: 'PHONE_QUALITY_FLAGGED',
    severity: 'critical',
    message: `Meta flagged this phone number. Pause outbound campaigns and review recent templates before sending again.`,
    active: normalizedEvent === 'FLAGGED',
  });

  alerts = upsertAlert(alerts, {
    code: 'PHONE_LIMIT_DOWNGRADED',
    severity: 'warning',
    message: `Meta downgraded this phone number's messaging limit to ${currentLimit || 'a lower tier'}.`,
    active: normalizedEvent === 'DOWNGRADE',
  });

  alerts = upsertAlert(alerts, {
    code: 'PHONE_LIMIT_RESTRICTED',
    severity: 'warning',
    message: `This phone number is still onboarding or limited by Meta. Broadcast capacity may be lower than expected.`,
    active: normalizedEvent === 'ONBOARDING',
  });

  organization.metaConfig.activeAlerts = alerts;
};

export const getMessagingLimitCount = limitTierToCount;

export const buildBroadcastLimitWarning = ({
  projectedRecipients,
  messagingLimitTier,
}: {
  projectedRecipients: number;
  messagingLimitTier?: string | null;
}) => {
  const limit = limitTierToCount(messagingLimitTier);
  if (!limit || limit === Number.MAX_SAFE_INTEGER) {
    return null;
  }

  if (projectedRecipients <= limit) {
    return null;
  }

  return {
    code: 'META_LIMIT_EXCEEDED_WARNING',
    message: `This broadcast targets ${projectedRecipients} recipients, which exceeds the current Meta messaging tier of ${limit}.`,
    tier: messagingLimitTier,
    limit,
  };
};

export const syncOrganizationMessagingHealth = async (organization: any) => {
  if (!organization?.metaConfig?.wabaId || !organization?.metaConfig?.phoneNumberId || !organization?.metaConfig?.accessToken) {
    return null;
  }

  const response = await axios.get(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${organization.metaConfig.wabaId}/phone_numbers`,
    {
      headers: buildMetaHeaders(organization.metaConfig.accessToken),
      params: {
        fields: 'id,display_phone_number,verified_name,quality_rating,current_limit',
      },
    }
  );

  const phoneNumbers = response.data?.data ?? [];
  const matchedPhone = phoneNumbers.find(
    (phoneNumber: any) => phoneNumber.id === organization.metaConfig.phoneNumberId
  );

  if (!matchedPhone) {
    return null;
  }

  organization.metaConfig.displayPhoneNumber =
    matchedPhone.display_phone_number || organization.metaConfig.displayPhoneNumber;
  organization.metaConfig.qualityRating = matchedPhone.quality_rating
    ? String(matchedPhone.quality_rating).trim().toUpperCase()
    : organization.metaConfig.qualityRating;
  organization.metaConfig.messagingLimitTier =
    normalizeTierLimit(matchedPhone.current_limit) || organization.metaConfig.messagingLimitTier;
  organization.metaConfig.lastMessagingLimitSyncAt = new Date();
  organization.metaConfig.lastHealthCheckAt = new Date();
  applyQualityAlerts(
    organization,
    organization.metaConfig.qualityStatus,
    organization.metaConfig.messagingLimitTier
  );

  await organization.save({ validateBeforeSave: false });

  return {
    displayPhoneNumber: organization.metaConfig.displayPhoneNumber,
    qualityRating: organization.metaConfig.qualityRating,
    messagingLimitTier: organization.metaConfig.messagingLimitTier,
    lastMessagingLimitSyncAt: organization.metaConfig.lastMessagingLimitSyncAt,
  };
};

export const applyPhoneNumberQualityWebhook = async ({
  organization,
  event,
  currentLimit,
}: {
  organization: any;
  event?: string | null;
  currentLimit?: string | null;
}) => {
  organization.metaConfig.qualityStatus = event ? String(event).trim().toUpperCase() : organization.metaConfig.qualityStatus;
  if (currentLimit) {
    organization.metaConfig.messagingLimitTier = normalizeTierLimit(currentLimit);
  }
  organization.metaConfig.lastMessagingLimitSyncAt = new Date();
  organization.metaConfig.lastHealthCheckAt = new Date();
  applyQualityAlerts(organization, event, currentLimit || organization.metaConfig.messagingLimitTier);
  await organization.save({ validateBeforeSave: false });

  return {
    qualityStatus: organization.metaConfig.qualityStatus,
    messagingLimitTier: organization.metaConfig.messagingLimitTier,
    activeAlerts: organization.metaConfig.activeAlerts || [],
  };
};
