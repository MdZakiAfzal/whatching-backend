import { Request, Response, NextFunction } from 'express';
import * as orgService from '../services/organizationService';
import Organization from '../models/Organization';
import Membership from '../models/Membership';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { decrypt, encrypt } from '../utils/encryption';
import * as whatsappService from '../services/whatsappService';
import { logIntegrationAction } from '../services/integrationLogService';
import { getMessagingBillingState } from '../utils/messagingBilling';
import { syncOrganizationMessagingHealth } from '../services/metaOperationalService';
import Subscriber from '../models/Subscriber';

const getMetaAccessTokenFromBody = (body: Record<string, unknown>) => {
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
  const legacyCode = typeof body.code === 'string' ? body.code.trim() : '';

  return accessToken || legacyCode;
};

const ensureMetaAssetOwnership = async (orgId: string, wabaId: string, phoneNumberId: string) => {
  const conflictingOrganization = await Organization.findOne({
    _id: { $ne: orgId },
    $or: [
      { 'metaConfig.wabaId': wabaId },
      { 'metaConfig.phoneNumberId': phoneNumberId },
    ],
  }).select('_id name metaConfig.wabaId metaConfig.phoneNumberId');

  if (conflictingOrganization) {
    throw new AppError(
      'This WhatsApp Business Account or phone number is already connected to another organization.',
      409
    );
  }
};

const serializeOrganization = (organization: any) => {
  const plainOrganization =
    organization && typeof organization.toObject === 'function'
      ? organization.toObject()
      : organization;

  if (!plainOrganization) {
    return plainOrganization;
  }

  if (plainOrganization.metaConfig?.accessToken) {
    delete plainOrganization.metaConfig.accessToken;
  }

  return {
    ...plainOrganization,
    messagingBilling: getMessagingBillingState(plainOrganization),
  };
};

const isValidIanaTimezone = (timezone: string) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

// STAGE 1: Create the basic business identity
export const setupOrganization = catchAsync(async (req: any, res: Response) => {
  const { name } = req.body;

  if (!name) throw new AppError('Business name is required', 400);
    
  const organization = await orgService.createOrganization(name, req.user._id);

  res.status(201).json({
    status: 'success',
    data: { organization: serializeOrganization(organization) },
  });
});

// STAGE 2: Link Meta credentials after Embedded Signup
export const connectMeta = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { wabaId, phoneNumberId } = req.body;
  const orgId = req.org._id;
  const rawAccessToken = getMetaAccessTokenFromBody(req.body);

  const membership = await Membership.findOne({ 
    userId: req.user._id, 
    orgId, 
    role: 'owner' 
  });
  
  if (!membership) {
    return next(new AppError('You do not have permission to manage this business.', 403));
  }

  try {
    await ensureMetaAssetOwnership(String(orgId), wabaId, phoneNumberId);

    const resolvedConnection = await whatsappService.resolveMetaConnection(
      rawAccessToken,
      wabaId,
      phoneNumberId
    );
    const encryptedToken = encrypt(rawAccessToken);

    await Organization.findByIdAndUpdate(
      orgId,
      {
        'metaConfig.wabaId': resolvedConnection.wabaId,
        'metaConfig.phoneNumberId': resolvedConnection.phoneNumberId,
        'metaConfig.accessToken': encryptedToken,
        'metaConfig.status': 'ready',
        'metaConfig.connectedAt': new Date(),
        'metaConfig.lastHealthCheckAt': new Date(),
        'metaConfig.businessAccountName': resolvedConnection.businessAccountName,
        'metaConfig.displayPhoneNumber': resolvedConnection.displayPhoneNumber,
      },
      { returnDocument: 'after', runValidators: true }
    );

    const organization = await Organization.findById(orgId).select('+metaConfig.accessToken');
    if (organization) {
      await syncOrganizationMessagingHealth(organization);
    }

    await logIntegrationAction({
      orgId,
      actorUserId: req.user._id,
      action: 'meta_connect',
      status: 'success',
      details: {
        wabaId: resolvedConnection.wabaId,
        phoneNumberId: resolvedConnection.phoneNumberId,
        displayPhoneNumber: resolvedConnection.displayPhoneNumber,
      },
      externalRef: resolvedConnection.phoneNumberId,
    });

    res.status(200).json({
      status: 'success',
      data: { organization: serializeOrganization(organization) }
    });
  } catch (error: any) {
    await logIntegrationAction({
      orgId,
      actorUserId: req.user._id,
      action: 'meta_connect',
      status: 'failed',
      details: {
        attemptedWabaId: wabaId,
        attemptedPhoneNumberId: phoneNumberId,
        reason: error.message,
      },
      externalRef: phoneNumberId,
    });

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(`Meta connection failed: ${error.message}`, 502);
  }
});

export const getIntegrationStatus = catchAsync(async (req: any, res: Response) => {
  const org = req.org; // Populated by setOrgContext middleware

  res.status(200).json({
    status: 'success',
    data: {
      integration: {
        state: org.metaConfig?.status || 'pending',
        wabaId: org.metaConfig?.wabaId,
        phoneNumberId: org.metaConfig?.phoneNumberId,
        businessAccountName: org.metaConfig?.businessAccountName,
        displayPhoneNumber: org.metaConfig?.displayPhoneNumber,
        connectedAt: org.metaConfig?.connectedAt || null,
        webhookVerified: !!org.metaConfig?.webhookVerifiedAt,
        webhookVerifiedAt: org.metaConfig?.webhookVerifiedAt || null,
        lastHealthCheckAt: org.metaConfig?.lastHealthCheckAt || null,
        lastTemplateSyncAt: org.metaConfig?.lastTemplateSyncAt || null,
        lastMessagingLimitSyncAt: org.metaConfig?.lastMessagingLimitSyncAt || null,
        messagingLimitTier: org.metaConfig?.messagingLimitTier || null,
        qualityRating: org.metaConfig?.qualityRating || null,
        qualityStatus: org.metaConfig?.qualityStatus || null,
        activeAlerts: org.metaConfig?.activeAlerts || [],
        timezone: org.timezone || 'UTC',
        messagingBilling: getMessagingBillingState(org),
      }
    }
  });
});

export const syncMetaIntegration = catchAsync(async (req: any, res: Response) => {
  const organization = await Organization.findById(req.org._id).select('+metaConfig.accessToken');

  if (!organization?.metaConfig?.wabaId || !organization.metaConfig.phoneNumberId || !organization.metaConfig.accessToken) {
    throw new AppError('Your Meta account is not connected yet.', 400);
  }

  try {
    const resolvedConnection = await whatsappService.resolveMetaConnection(
      decrypt(organization.metaConfig.accessToken),
      organization.metaConfig.wabaId,
      organization.metaConfig.phoneNumberId
    );

    organization.metaConfig.status = 'ready';
    organization.metaConfig.lastHealthCheckAt = new Date();
    organization.metaConfig.businessAccountName = resolvedConnection.businessAccountName;
    organization.metaConfig.displayPhoneNumber = resolvedConnection.displayPhoneNumber;
    await syncOrganizationMessagingHealth(organization);

    await logIntegrationAction({
      orgId: organization._id,
      actorUserId: req.user._id,
      action: 'meta_sync',
      status: 'success',
      details: {
        wabaId: resolvedConnection.wabaId,
        phoneNumberId: resolvedConnection.phoneNumberId,
      },
      externalRef: resolvedConnection.phoneNumberId,
    });

    res.status(200).json({
      status: 'success',
      data: {
        integration: {
          state: organization.metaConfig.status,
          wabaId: organization.metaConfig.wabaId,
          phoneNumberId: organization.metaConfig.phoneNumberId,
          businessAccountName: organization.metaConfig.businessAccountName,
          displayPhoneNumber: organization.metaConfig.displayPhoneNumber,
          webhookVerified: !!organization.metaConfig.webhookVerifiedAt,
          webhookVerifiedAt: organization.metaConfig.webhookVerifiedAt || null,
          connectedAt: organization.metaConfig.connectedAt || null,
          lastHealthCheckAt: organization.metaConfig.lastHealthCheckAt || null,
          lastTemplateSyncAt: organization.metaConfig.lastTemplateSyncAt || null,
          lastMessagingLimitSyncAt: organization.metaConfig.lastMessagingLimitSyncAt || null,
          messagingLimitTier: organization.metaConfig.messagingLimitTier || null,
          qualityRating: organization.metaConfig.qualityRating || null,
          qualityStatus: organization.metaConfig.qualityStatus || null,
          activeAlerts: organization.metaConfig.activeAlerts || [],
          timezone: organization.timezone || 'UTC',
          messagingBilling: getMessagingBillingState(organization),
        },
      },
    });
  } catch (error: any) {
    await logIntegrationAction({
      orgId: organization._id,
      actorUserId: req.user._id,
      action: 'meta_sync',
      status: 'failed',
      details: { reason: error.message },
      externalRef: organization.metaConfig.phoneNumberId,
    });
    throw new AppError(`Meta sync failed: ${error.message}`, 502);
  }
});

export const getMyOrganizations = catchAsync(async (req: any, res: Response) => {
  // Find all memberships for this user and populate the full Organization details
  const memberships = await Membership.find({ userId: req.user._id, status: 'active' })
    .populate('orgId');

  // Extract only the organization documents
  const organizations = memberships.map(m => m.orgId);

  res.status(200).json({
    status: 'success',
    results: organizations.length,
    data: { organizations: organizations.map(serializeOrganization) }
  });
});

export const getOrganization = catchAsync(async (req: any, res: Response) => {
  // req.org is populated by the setOrgContext middleware
  res.status(200).json({
    status: 'success',
    data: { 
      organization: serializeOrganization(req.org)
    }
  });
});

export const updateOrganizationSettings = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { timezone } = req.body;

  if (!isValidIanaTimezone(timezone)) {
    return next(new AppError('Please provide a valid IANA timezone, for example Asia/Kolkata.', 400));
  }

  const organization = await Organization.findByIdAndUpdate(
    req.org._id,
    {
      timezone,
    },
    {
      returnDocument: 'after',
      runValidators: true,
    }
  );

  res.status(200).json({
    status: 'success',
    data: {
      organization: serializeOrganization(organization),
    },
  });
});


export const addOrganizationTag = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { tag } = req.body;
  const normalizedTag = tag.trim();

  // $addToSet ensures we don't add duplicate tags
  const organization = await Organization.findByIdAndUpdate(
    req.org._id,
    { $addToSet: { tags: normalizedTag } },
    { new: true, runValidators: true }
  );

  res.status(201).json({ 
    status: 'success', 
    data: { tags: organization?.tags } 
  });
});

export const getOrganizationTags = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  // Fetch only the tags array to keep the payload incredibly lightweight
  const organization = await Organization.findById(req.org._id).select('tags');

  if (!organization) {
    return next(new AppError('Organization not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { 
      tags: organization.tags 
    }
  });
});

export const deleteOrganizationTag = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { tag } = req.params;
  const decodedTag = decodeURIComponent(tag).trim();

  // 1. Remove from organization master list
  const organization = await Organization.findByIdAndUpdate(
    req.org._id,
    { $pull: { tags: decodedTag } },
    { new: true }
  );

  if (!organization) return next(new AppError('Organization not found.', 404));

  // 👉 2. BACKGROUND CLEANUP: Strip tag, then catch any resulting orphans
  Subscriber.updateMany(
    { orgId: req.org._id, tags: decodedTag },
    { $pull: { tags: decodedTag } }
  )
    .then(() => {
      // Find anyone whose tags array just dropped to size 0, and give them the fallback
      return Subscriber.updateMany(
        { orgId: req.org._id, tags: { $size: 0 } },
        { $push: { tags: 'General' } }
      );
    })
    .catch(err => console.error('Failed to cleanup tags from subscribers:', err));

  res.status(200).json({ 
    status: 'success', 
    data: { tags: organization.tags } 
  });
});