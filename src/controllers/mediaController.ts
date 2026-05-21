import { Response, NextFunction } from 'express';
import Media from '../models/Media';
import Organization from '../models/Organization';
import catchAsync from '../utils/catchAsync';
import AppError from '../utils/AppError';
import { decrypt } from '../utils/encryption';
import { config } from '../config';
import { uploadBufferToCloudinary } from '../services/cloudinaryService';
import { createMetaUploadSession, uploadBytesToMeta } from '../services/mediaService';

// Helper to map MIME types to Cloudinary resource types
const getResourceType = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video';
  return 'raw';
};

export const bulkUploadMedia = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const files = req.files as Express.Multer.File[];
  const orgId = req.org._id;

  if (!files || files.length === 0) {
    return next(new AppError('Please provide at least one file to upload.', 400));
  }

  // 1. Fetch credentials
  const organization = await Organization.findById(orgId).select('+metaConfig.accessToken');
  const accessToken = organization?.metaConfig?.accessToken ? decrypt(organization.metaConfig.accessToken) : null;
  const appId = config.meta.appId;

  // 2. Process all files concurrently
  const uploadPromises = files.map(async (file) => {
    let cloudinaryUrl = '';
    let metaHandle = '';

    // Step A: Cloudinary (Always Attempt)
    try {
      const uploadResult = await uploadBufferToCloudinary({
        buffer: file.buffer,
        folder: `${config.cloudinary.folder}/library/${orgId}`,
        filename: file.originalname,
        resourceType: getResourceType(file.mimetype),
        mimeType: file.mimetype,
        tags: ['whatching', 'library'],
      });
      cloudinaryUrl = uploadResult.secure_url;
    } catch (error) {
      throw new Error(`Cloudinary failed for ${file.originalname}`);
    }

    // Step B: Meta Upload (Only if Meta is connected)
    if (accessToken && appId) {
      try {
        const sessionId = await createMetaUploadSession(appId, accessToken, file.size, file.mimetype);
        metaHandle = await uploadBytesToMeta(sessionId, accessToken, file.buffer);
      } catch (error) {
        // We log but DO NOT throw. Cloudinary succeeded, so we still save the file!
        console.warn(`Meta upload skipped/failed for ${file.originalname}:`, error);
      }
    }

    // Step C: Save to database
    return await Media.create({
      orgId,
      name: file.originalname,
      fileType: file.mimetype.startsWith('image') ? 'image' : file.mimetype.startsWith('video') ? 'video' : 'document',
      fileSize: file.size,
      cloudinaryUrl,
      metaHandle: metaHandle || undefined,
    });
  });

  const results = await Promise.allSettled(uploadPromises);

  const successfulUploads = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<any>).value);

  const failedCount = results.length - successfulUploads.length;

  res.status(201).json({
    status: 'success',
    message: `Successfully uploaded ${successfulUploads.length} files. ${failedCount > 0 ? `${failedCount} failed.` : ''}`,
    data: { media: successfulUploads },
  });
});

// GET route so the frontend can display the Asset Library
export const getMediaLibrary = catchAsync(async (req: any, res: Response) => {
  const { hasMetaHandle } = req.query;
  const filter: any = { orgId: req.org._id };

  // Frontend adds ?hasMetaHandle=true when building Templates!
  if (hasMetaHandle === 'true') {
    filter.metaHandle = { $exists: true, $ne: null };
  }

  const media = await Media.find(filter).sort('-createdAt');

  res.status(200).json({
    status: 'success',
    results: media.length,
    data: { media }
  });
});

// GET /:mediaId - Fetch a single media item
export const getMedia = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { mediaId } = req.params;

  const media = await Media.findOne({
    _id: mediaId,
    orgId: req.org._id
  });

  if (!media) {
    return next(new AppError('Media not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: { media }
  });
});

// POST /bulk-delete - Safely delete 1 or many media references
export const bulkDeleteMedia = catchAsync(async (req: any, res: Response, next: NextFunction) => {
  const { mediaIds } = req.body;
  const orgId = req.org._id;

  // Execute a single bulk delete query
  const result = await Media.deleteMany({
    _id: { $in: mediaIds },
    orgId: orgId
  });

  if (result.deletedCount === 0) {
    return next(new AppError('No matching media found to delete.', 404));
  }

  res.status(200).json({
    status: 'success',
    message: `Successfully removed ${result.deletedCount} media asset(s) from your library.`,
    data: { deletedCount: result.deletedCount }
  });
});