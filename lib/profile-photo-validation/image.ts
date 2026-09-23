import sharp from 'sharp';
import {
  MAX_NORMALIZED_PHOTO_BYTES,
  MAX_PROFILE_PHOTO_PIXELS,
  NORMALIZED_PHOTO_MAX_EDGE,
  NORMALIZED_PHOTO_MIN_EDGE,
  MAX_PROFILE_PHOTO_SOURCE_BYTES,
} from './config';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

export class ProfilePhotoImageError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ProfilePhotoImageError';
    this.code = code;
    this.status = status;
  }
}

export async function normalizeProfilePhoto(input: Buffer, declaredMimeType: string) {
  if (!input.byteLength || input.byteLength > MAX_PROFILE_PHOTO_SOURCE_BYTES) {
    throw new ProfilePhotoImageError('INVALID_SIZE', 'Choose a photo smaller than 5 MB.', 413);
  }
  let metadata;
  try {
    metadata = await sharp(input, {
      failOn: 'warning',
      limitInputPixels: MAX_PROFILE_PHOTO_PIXELS,
      animated: false,
    }).metadata();
  } catch {
    throw new ProfilePhotoImageError(
      'CORRUPT_IMAGE',
      'This image could not be read. Choose another photo.',
    );
  }

  if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
    throw new ProfilePhotoImageError(
      'UNSUPPORTED_FORMAT',
      'Use a JPEG, PNG, WebP, HEIC, or HEIF photo.',
      415,
    );
  }
  const mimeByFormat: Record<string, string[]> = {
    jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'],
    heif: ['image/heic', 'image/heif'],
  };
  if (!mimeByFormat[metadata.format]?.includes(declaredMimeType)
      || (metadata.format === 'heif' && metadata.compression !== 'hevc')) {
    throw new ProfilePhotoImageError('MIME_MISMATCH', 'The image format does not match its file type.', 415);
  }
  if ((metadata.pages || 1) > 1) {
    throw new ProfilePhotoImageError(
      'ANIMATED_IMAGE',
      'Animated or multi-frame images are not supported.',
      415,
    );
  }
  if (!metadata.width || !metadata.height
      || metadata.width * metadata.height > MAX_PROFILE_PHOTO_PIXELS) {
    throw new ProfilePhotoImageError(
      'IMAGE_DIMENSIONS',
      'This photo is too large to process. Choose a smaller image.',
      413,
    );
  }

  const pipeline = sharp(input, {
    failOn: 'warning',
    limitInputPixels: MAX_PROFILE_PHOTO_PIXELS,
    animated: false,
  })
    .timeout({ seconds: 5 })
    .rotate()
    .flatten({ background: '#f2f2f2' })
    .resize({
      width: NORMALIZED_PHOTO_MAX_EDGE,
      height: NORMALIZED_PHOTO_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true });

  let normalized;
  try {
    normalized = await pipeline.toBuffer({ resolveWithObject: true });
  } catch {
    throw new ProfilePhotoImageError(
      'CORRUPT_IMAGE',
      'This image could not be processed. Choose another photo.',
    );
  }

  const { width, height } = normalized.info;
  if (!width || !height || Math.min(width, height) < NORMALIZED_PHOTO_MIN_EDGE) {
    throw new ProfilePhotoImageError(
      'IMAGE_TOO_SMALL',
      'This photo is too small. Choose a higher-resolution image.',
      422,
    );
  }
  if (normalized.data.byteLength > MAX_NORMALIZED_PHOTO_BYTES) {
    throw new ProfilePhotoImageError(
      'NORMALIZED_IMAGE_TOO_LARGE',
      'This photo could not be reduced to a safe upload size.',
      413,
    );
  }

  return { bytes: normalized.data, width, height, mimeType: 'image/jpeg' };
}
