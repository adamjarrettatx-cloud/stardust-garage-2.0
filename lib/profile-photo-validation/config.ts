export type PhotoMode = 'legacy' | 'shadow' | 'enforce' | 'paused';
type Environment = Readonly<Record<string, string | undefined>>;

export function profilePhotoValidationMode(env: Environment = process.env): PhotoMode {
  if (env.PROFILE_PHOTO_MODE === undefined) return 'legacy';
  switch (env.PROFILE_PHOTO_MODE) {
    case 'legacy': case 'shadow': case 'enforce': case 'paused':
      return env.PROFILE_PHOTO_MODE;
    // Invalid configuration must not silently downgrade an enforced policy.
    default: return 'paused';
  }
}

export function requirePhotoProviderConfiguration(env: Environment = process.env): string {
  const mode = profilePhotoValidationMode(env);
  if (mode !== 'shadow' && mode !== 'enforce') throw new Error('PHOTO_PROCESSING_DISABLED');
  if (env.PROFILE_PHOTO_PRIVACY_READY !== 'true') throw new Error('PHOTO_PRIVACY_NOT_READY');
  if (env.PROFILE_PHOTO_PROVIDER !== 'aws_rekognition' || !env.AWS_REGION?.trim()) {
    throw new Error('PHOTO_PROVIDER_NOT_CONFIGURED');
  }
  return env.AWS_REGION.trim();
}

export const PROFILE_PHOTO_UPLOAD_BUCKET = 'profile-photo-uploads';
export const PROFILE_PHOTO_UPLOAD_TTL_MINUTES = 15;
export const MAX_PROFILE_PHOTO_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_PROFILE_PHOTO_PIXELS = 40_000_000;
export const MAX_NORMALIZED_PHOTO_BYTES = 2 * 1024 * 1024;
export const NORMALIZED_PHOTO_MAX_EDGE = 1600;
export const NORMALIZED_PHOTO_MIN_EDGE = 320;
