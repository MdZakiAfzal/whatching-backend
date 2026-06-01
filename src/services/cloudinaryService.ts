import { v2 as cloudinary } from 'cloudinary';
import AppError from '../utils/AppError';
import { config } from '../config';

const isConfigured = Boolean(
  config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret
);

if (isConfigured) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
}

export const ensureCloudinaryConfigured = () => {
  if (!isConfigured) {
    throw new AppError('Cloudinary is not configured for media handling.', 503);
  }
};

export const uploadBufferToCloudinary = async ({
  buffer,
  folder,
  resourceType = 'auto',
  publicId,
  filename,
  mimeType,
  tags = [],
}: {
  buffer: Buffer;
  folder: string;
  resourceType?: 'image' | 'video' | 'raw' | 'auto';
  publicId?: string;
  filename?: string;
  mimeType?: string;
  tags?: string[];
}) => {
  ensureCloudinaryConfigured();

  return await new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        public_id: publicId,
        filename_override: filename,
        tags,
        context: mimeType ? `mime_type=${mimeType}` : undefined,
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary upload failed.'));
          return;
        }
        resolve(result);
      }
    );

    stream.end(buffer);
  });
};

export const deleteFromCloudinary = async ({
  publicId,
  resourceType = 'raw',
}: {
  publicId: string;
  resourceType?: 'image' | 'video' | 'raw';
}) => {
  ensureCloudinaryConfigured();
  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
  });
};
