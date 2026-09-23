import { afterEach, describe, expect, it } from 'vitest';
import {
  createFaceDetector,
  parseRekognitionResponse,
} from '@/lib/profile-photo-validation/provider';

const env = {
  PROFILE_PHOTO_MODE: process.env.PROFILE_PHOTO_MODE,
  PROFILE_PHOTO_PRIVACY_READY: process.env.PROFILE_PHOTO_PRIVACY_READY,
  PROFILE_PHOTO_PROVIDER: process.env.PROFILE_PHOTO_PROVIDER,
  AWS_REGION: process.env.AWS_REGION,
};

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function response(overrides = {}) {
  return {
    FaceDetails: [{
      Confidence: 99.9,
      BoundingBox: { Width: 0.5, Height: 0.5, Left: 0.2, Top: 0.2 },
      Pose: { Yaw: 0, Pitch: 0, Roll: 0 },
      Quality: { Brightness: 75, Sharpness: 75 },
      FaceOccluded: { Value: false, Confidence: 99 },
    }],
    $metadata: {},
    ...overrides,
  };
}

describe('AWS face detector adapter', () => {
  it('maps only policy-required fields into the provider-neutral record', () => {
    expect(parseRekognitionResponse(response())).toEqual({
      provider: 'aws_rekognition',
      faces: [{
        confidence: 99.9,
        box: { width: 0.5, height: 0.5, left: 0.2, top: 0.2 },
        pose: { yaw: 0, pitch: 0, roll: 0 },
        quality: { brightness: 75, sharpness: 75 },
        occlusion: { occluded: false, confidence: 99 },
      }],
    });
  });

  it('fails closed on omitted provider fields', () => {
    const broken = response();
    delete broken.FaceDetails[0].Quality;
    expect(() => parseRekognitionResponse(broken)).toThrow(TypeError);
  });

  it('will not call AWS without the explicit privacy and rollout gates', async () => {
    process.env.PROFILE_PHOTO_MODE = 'enforce';
    delete process.env.PROFILE_PHOTO_PRIVACY_READY;
    const sender = async () => response();
    await expect(createFaceDetector(sender)(new Uint8Array([1]))).rejects
      .toThrow('PHOTO_PRIVACY_NOT_READY');
  });

  it('requests only DEFAULT and FACE_OCCLUDED using the injected sender', async () => {
    process.env.PROFILE_PHOTO_MODE = 'shadow';
    process.env.PROFILE_PHOTO_PRIVACY_READY = 'true';
    process.env.PROFILE_PHOTO_PROVIDER = 'aws_rekognition';
    process.env.AWS_REGION = 'us-east-2';
    let input;
    const sender = async (command) => {
      input = command.input;
      return response();
    };
    const result = await createFaceDetector(sender)(new Uint8Array([1, 2, 3]));
    expect(input.Attributes).toEqual(['DEFAULT', 'FACE_OCCLUDED']);
    expect(Array.from(input.Image.Bytes)).toEqual([1, 2, 3]);
    expect(result.faces).toHaveLength(1);
  });

  it('honors an already-aborted caller signal', async () => {
    process.env.PROFILE_PHOTO_MODE = 'shadow';
    process.env.PROFILE_PHOTO_PRIVACY_READY = 'true';
    process.env.PROFILE_PHOTO_PROVIDER = 'aws_rekognition';
    process.env.AWS_REGION = 'us-east-2';
    const caller = new AbortController();
    caller.abort();
    const sender = async (_command, { abortSignal }) => {
      expect(abortSignal.aborted).toBe(true);
      throw new Error('aborted');
    };
    await expect(createFaceDetector(sender)(new Uint8Array([1]), { signal: caller.signal }))
      .rejects.toThrow('aborted');
  });
});
