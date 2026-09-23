import { DetectFacesCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import type { DetectFacesCommandOutput } from '@aws-sdk/client-rekognition';
import type { FaceDetectionResult, FaceDetector } from './contracts';
import { requirePhotoProviderConfiguration } from './config';
import { assertDetectedFaces } from './policy';

// Import from server-only code. No credentials are read or embedded here:
// the AWS SDK uses the deployment's server-side credential provider chain.
export function parseRekognitionResponse(response: DetectFacesCommandOutput): FaceDetectionResult {
  if (!Array.isArray(response.FaceDetails)) {
    throw new TypeError('Malformed face-detection response.');
  }
  const faces = response.FaceDetails.map((face) => ({
    confidence: face.Confidence,
    box: {
      width: face.BoundingBox?.Width, height: face.BoundingBox?.Height,
      left: face.BoundingBox?.Left, top: face.BoundingBox?.Top,
    },
    pose: { yaw: face.Pose?.Yaw, pitch: face.Pose?.Pitch, roll: face.Pose?.Roll },
    quality: { brightness: face.Quality?.Brightness, sharpness: face.Quality?.Sharpness },
    occlusion: { occluded: face.FaceOccluded?.Value, confidence: face.FaceOccluded?.Confidence },
  }));
  assertDetectedFaces(faces);
  return { faces, provider: 'aws_rekognition' };
}

// Dependency injection permits deterministic tests without any AWS request.
type Sender = (command: DetectFacesCommand, options: { abortSignal: AbortSignal }) =>
  Promise<DetectFacesCommandOutput>;

export function createFaceDetector(sender?: Sender): FaceDetector {
  return async (imageBytes, { signal } = {}) => {
    const region = requirePhotoProviderConfiguration();
    if (!imageBytes.byteLength || imageBytes.byteLength > 2 * 1024 * 1024) {
      throw new RangeError('Invalid normalized photo size.');
    }
    const client = sender ? null : new RekognitionClient({ region, maxAttempts: 1 });
    const send: Sender = sender || ((command, options) => client!.send(command, options));
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 6000);
    try {
      // The provider receives the same normalized byte snapshot that the
      // future completion service must hash and persist, never a public URL.
      const response = await send(new DetectFacesCommand({
        Image: { Bytes: imageBytes },
        Attributes: ['DEFAULT', 'FACE_OCCLUDED'],
      }), { abortSignal: controller.signal });
      return parseRekognitionResponse(response);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      client?.destroy();
    }
  };
}
