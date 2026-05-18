import axios from 'axios';
import path from 'path';
import { decrypt } from '../utils/encryption';
import { uploadBufferToCloudinary } from './cloudinaryService';
import { config } from '../config';

const GRAPH_API_VERSION = 'v20.0';

const buildMetaHeaders = (encryptedAccessToken: string) => ({
  Authorization: `Bearer ${decrypt(encryptedAccessToken)}`,
});

const resolveCloudinaryResourceType = (messageType: string, mimeType?: string | null) => {
  const normalizedType = String(messageType || '').toLowerCase();
  const normalizedMimeType = String(mimeType || '').toLowerCase();

  if (normalizedType === 'image' || normalizedMimeType.startsWith('image/')) {
    return 'image' as const;
  }

  if (
    normalizedType === 'audio' ||
    normalizedType === 'video' ||
    normalizedMimeType.startsWith('audio/') ||
    normalizedMimeType.startsWith('video/')
  ) {
    return 'video' as const;
  }

  return 'raw' as const;
};

const buildMetaFileName = (messageType: string, mediaId: string, mimeType?: string | null, originalFilename?: string | null) => {
  if (originalFilename) {
    return originalFilename;
  }

  const extension = mimeType?.includes('/') ? `.${mimeType.split('/')[1]}` : '';
  return `${messageType || 'media'}-${mediaId}${extension}`;
};

export const fetchMetaMediaDescriptor = async ({
  encryptedAccessToken,
  mediaId,
  phoneNumberId,
}: {
  encryptedAccessToken: string;
  mediaId: string;
  phoneNumberId?: string;
}) => {
  const response = await axios.get(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
    {
      headers: buildMetaHeaders(encryptedAccessToken),
      params: phoneNumberId ? { phone_number_id: phoneNumberId } : undefined,
    }
  );

  return response.data;
};

export const downloadMetaMedia = async ({
  encryptedAccessToken,
  mediaUrl,
}: {
  encryptedAccessToken: string;
  mediaUrl: string;
}) => {
  const response = await axios.get(mediaUrl, {
    headers: buildMetaHeaders(encryptedAccessToken),
    responseType: 'arraybuffer',
  });

  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers['content-type'],
    contentLength: response.headers['content-length']
      ? Number.parseInt(String(response.headers['content-length']), 10)
      : undefined,
  };
};

export const persistInboundMetaMedia = async ({
  orgId,
  encryptedAccessToken,
  phoneNumberId,
  mediaId,
  messageType,
  originalFilename,
}: {
  orgId: string;
  encryptedAccessToken: string;
  phoneNumberId?: string;
  mediaId: string;
  messageType: string;
  originalFilename?: string | null;
}) => {
  const descriptor = await fetchMetaMediaDescriptor({
    encryptedAccessToken,
    mediaId,
    phoneNumberId,
  });
  const download = await downloadMetaMedia({
    encryptedAccessToken,
    mediaUrl: descriptor.url,
  });

  const fileName = buildMetaFileName(
    messageType,
    mediaId,
    descriptor.mime_type || download.mimeType,
    originalFilename
  );
  const uploadResult = await uploadBufferToCloudinary({
    buffer: download.buffer,
    folder: `${config.cloudinary.folder}/inbound/${orgId}`,
    filename: fileName,
    resourceType: resolveCloudinaryResourceType(messageType, descriptor.mime_type || download.mimeType),
    mimeType: descriptor.mime_type || download.mimeType,
    tags: ['whatching', 'inbound', messageType],
  });

  return {
    metaMediaId: descriptor.id || mediaId,
    mediaUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    resourceType: uploadResult.resource_type,
    mimeType: descriptor.mime_type || download.mimeType,
    fileSize: descriptor.file_size ? Number(descriptor.file_size) : download.contentLength,
    sha256: descriptor.sha256,
    originalFilename: fileName,
  };
};

export const uploadAgentReplyAttachment = async ({
  orgId,
  buffer,
  originalName,
  mimeType,
}: {
  orgId: string;
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}) => {
  const uploadResult = await uploadBufferToCloudinary({
    buffer,
    folder: `${config.cloudinary.folder}/outbound/${orgId}`,
    filename: originalName,
    resourceType: resolveCloudinaryResourceType(path.extname(originalName).slice(1), mimeType),
    mimeType,
    tags: ['whatching', 'outbound'],
  });

  return {
    mediaUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    resourceType: uploadResult.resource_type,
    mimeType,
    originalFilename: originalName,
  };
};
