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

  return {
    ...plainOrganization,
    messagingBilling: getMessagingBillingState(plainOrganization),
  };
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

    const organization = await Organization.findByIdAndUpdate(
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
    await organization.save({ validateBeforeSave: false });

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
