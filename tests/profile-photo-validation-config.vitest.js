import { afterEach, describe, expect, it } from 'vitest';
import {
  profilePhotoValidationMode,
  requirePhotoProviderConfiguration,
} from '@/lib/profile-photo-validation/config';

const prior = process.env.PROFILE_PHOTO_MODE;

afterEach(() => {
  if (prior === undefined) delete process.env.PROFILE_PHOTO_MODE;
  else process.env.PROFILE_PHOTO_MODE = prior;
});

describe('profile photo rollout mode', () => {
  it('defaults to legacy when unset and pauses on invalid configuration', () => {
    delete process.env.PROFILE_PHOTO_MODE;
    expect(profilePhotoValidationMode()).toBe('legacy');
    process.env.PROFILE_PHOTO_MODE = 'unexpected';
    expect(profilePhotoValidationMode()).toBe('paused');
  });

  it.each(['shadow', 'enforce', 'paused'])('recognizes %s', (mode) => {
    process.env.PROFILE_PHOTO_MODE = mode;
    expect(profilePhotoValidationMode()).toBe(mode);
  });

  it('requires explicit processing, privacy attestation, provider, and region', () => {
    expect(() => requirePhotoProviderConfiguration({})).toThrow('PHOTO_PROCESSING_DISABLED');
    expect(() => requirePhotoProviderConfiguration({ PROFILE_PHOTO_MODE: 'enforce' }))
      .toThrow('PHOTO_PRIVACY_NOT_READY');
    expect(() => requirePhotoProviderConfiguration({
      PROFILE_PHOTO_MODE: 'enforce', PROFILE_PHOTO_PRIVACY_READY: 'true',
    })).toThrow('PHOTO_PROVIDER_NOT_CONFIGURED');
    expect(requirePhotoProviderConfiguration({
      PROFILE_PHOTO_MODE: 'enforce', PROFILE_PHOTO_PRIVACY_READY: 'true',
      PROFILE_PHOTO_PROVIDER: 'aws_rekognition', AWS_REGION: 'us-east-2',
    })).toBe('us-east-2');
  });
});
