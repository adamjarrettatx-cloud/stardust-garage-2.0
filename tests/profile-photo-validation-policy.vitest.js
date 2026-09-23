import { describe, expect, it } from 'vitest';
import {
  evaluateFacePhoto,
  PROFILE_PHOTO_POLICY_VERSION,
} from '@/lib/profile-photo-validation/policy';

function face(overrides = {}) {
  return {
    confidence: 99.9,
    box: { width: 0.5, height: 0.5, left: 0.2, top: 0.2 },
    pose: { yaw: 0, pitch: 0, roll: 0 },
    quality: { brightness: 75, sharpness: 75 },
    occlusion: { occluded: false, confidence: 99 },
    ...overrides,
  };
}

const image = { width: 1000, height: 1000 };

describe('profile photo face policy', () => {
  it('accepts exactly one clear, large face', () => {
    expect(evaluateFacePhoto([face()], image)).toEqual({
      accepted: true,
      code: 'ACCEPTED',
      message: 'Photo accepted.',
      policyVersion: PROFILE_PHOTO_POLICY_VERSION,
    });
  });

  it.each([
    [[], 'NO_FACE'],
    [[face(), face()], 'MULTIPLE_FACES'],
    [[face({ confidence: 98 })], 'UNCERTAIN_FACE'],
    [[face({ box: { width: 0.3, height: 0.3, left: 0, top: 0 } })], 'FACE_TOO_SMALL'],
    [[face({ occlusion: { occluded: true, confidence: 95 } })], 'FACE_OBSCURED'],
    [[face({ pose: { yaw: 31, pitch: 0, roll: 0 } })], 'FACE_ANGLE'],
    [[face({ quality: { brightness: 24.9, sharpness: 75 } })], 'TOO_DARK'],
    [[face({ quality: { brightness: 75, sharpness: 24.9 } })], 'TOO_BLURRY'],
  ])('rejects with deterministic priority: %s', (faces, code) => {
    expect(evaluateFacePhoto(faces, image)).toMatchObject({ accepted: false, code });
  });

  it('counts background faces at the candidate threshold', () => {
    expect(evaluateFacePhoto([
      face(),
      face({ confidence: 95, box: { width: 0.03, height: 0.03, left: 0, top: 0 } }),
    ], image)).toMatchObject({ accepted: false, code: 'MULTIPLE_FACES' });
  });

  it('enforces pixel size independently of normalized face area', () => {
    expect(evaluateFacePhoto(
      [face({ box: { width: 0.5, height: 0.5, left: 0, top: 0 } })],
      { width: 150, height: 150 },
    )).toMatchObject({ accepted: false, code: 'FACE_TOO_SMALL' });
  });

  it('fails closed for malformed provider output', () => {
    expect(() => evaluateFacePhoto([face({ quality: null })], image))
      .toThrow('Malformed face-detection response');
  });

  it.each([
    { confidence: NaN }, { confidence: 101 },
    { occlusion: null }, { pose: { yaw: NaN, pitch: 0, roll: 0 } },
    { quality: { brightness: -1, sharpness: 75 } },
  ])('throws on invalid provider fields rather than passing or rejecting a user photo', (overrides) => {
    expect(() => evaluateFacePhoto([face(overrides)], image)).toThrow(TypeError);
  });

  it('accepts thresholds inclusively and ignores below-threshold background faces', () => {
    const candidate = face({
      confidence: 99, box: { width: 0.5, height: 0.3, left: 0, top: 0 },
      pose: { yaw: -30, pitch: 30, roll: -30 },
      quality: { brightness: 25, sharpness: 25 },
    });
    expect(evaluateFacePhoto([candidate, face({ confidence: 94.99 })], image).accepted).toBe(true);
  });
});
