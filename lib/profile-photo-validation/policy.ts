import type { DetectedFace, ImageDimensions, PhotoDecision, PhotoRejectionCode } from './contracts';

export const PROFILE_PHOTO_POLICY_VERSION = 'face_photo_v1';

export const PROFILE_PHOTO_POLICY = Object.freeze({
  candidateConfidence: 95,
  acceptedConfidence: 99,
  minimumFaceAreaRatio: 0.15,
  minimumFacePixels: 100,
  maximumAbsoluteYaw: 30,
  maximumAbsolutePitch: 30,
  maximumAbsoluteRoll: 30,
  minimumBrightness: 25,
  minimumSharpness: 25,
  occlusionConfidence: 90,
});

export const PHOTO_REJECTION_MESSAGES: Readonly<Record<PhotoRejectionCode, string>> = Object.freeze({
  NO_FACE: "We couldn't find a face in this photo. Choose a clear photo of your face.",
  MULTIPLE_FACES: 'Please choose a photo with only you in it.',
  UNCERTAIN_FACE: 'Please choose a photo where your face is clearly visible and facing the camera.',
  FACE_TOO_SMALL: 'Your face is too far away. Crop closer or choose another photo.',
  FACE_OBSCURED: 'Please choose a photo where your face is clearly visible and facing the camera.',
  FACE_ANGLE: 'Please choose a photo where your face is clearly visible and facing the camera.',
  TOO_DARK: 'This photo is too dark. Try one with more light on your face.',
  TOO_BLURRY: 'This photo is too blurry. Choose a clearer photo.',
});

const between = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// Validate even low-confidence detections. A malformed provider response is a
// service failure, not proof that there are no faces or permission to pass.
export function assertDetectedFaces(faces: unknown): asserts faces is DetectedFace[] {
  if (!Array.isArray(faces) || faces.length > 100) {
    throw new TypeError('Malformed face-detection response.');
  }
  for (const face of faces) {
    if (!face || !between(face.confidence, 0, 100)
      || !face.box || !between(face.box.width, Number.MIN_VALUE, 1)
      || !between(face.box.height, Number.MIN_VALUE, 1)
      // Edge faces can have coordinates outside the image; quality policy,
      // not this parser, determines suitability.
      || !between(face.box.left, -1, 1) || !between(face.box.top, -1, 1)
      || !face.pose || !between(face.pose.yaw, -180, 180)
      || !between(face.pose.pitch, -180, 180) || !between(face.pose.roll, -180, 180)
      || !face.quality || !between(face.quality.brightness, 0, 100)
      || !between(face.quality.sharpness, 0, 100)
      || !face.occlusion || typeof face.occlusion.occluded !== 'boolean'
      || !between(face.occlusion.confidence, 0, 100)) {
      throw new TypeError('Malformed face-detection response.');
    }
  }
}

export function evaluateFacePhoto(
  faces: unknown,
  image: ImageDimensions,
): PhotoDecision {
  assertDetectedFaces(faces);
  if (!Number.isInteger(image?.width) || !Number.isInteger(image?.height)
      || image.width <= 0 || image.height <= 0) {
    throw new TypeError('Invalid image dimensions.');
  }
  const policy = PROFILE_PHOTO_POLICY;
  const reject = (code: PhotoRejectionCode): PhotoDecision => ({
    accepted: false, code, message: PHOTO_REJECTION_MESSAGES[code],
    policyVersion: PROFILE_PHOTO_POLICY_VERSION,
  });
  const candidates = faces.filter((face) => face.confidence >= policy.candidateConfidence);
  if (!candidates.length) return reject('NO_FACE');
  if (candidates.length > 1) return reject('MULTIPLE_FACES');
  const face = candidates[0];
  if (face.confidence < policy.acceptedConfidence) return reject('UNCERTAIN_FACE');
  const box = face.box;
  if (box.width * box.height < policy.minimumFaceAreaRatio
      || box.width * image.width < policy.minimumFacePixels
      || box.height * image.height < policy.minimumFacePixels) return reject('FACE_TOO_SMALL');
  if (face.occlusion.occluded && face.occlusion.confidence >= policy.occlusionConfidence) {
    return reject('FACE_OBSCURED');
  }
  if (Math.abs(face.pose.yaw) > policy.maximumAbsoluteYaw
      || Math.abs(face.pose.pitch) > policy.maximumAbsolutePitch
      || Math.abs(face.pose.roll) > policy.maximumAbsoluteRoll) return reject('FACE_ANGLE');
  if (face.quality.brightness < policy.minimumBrightness) return reject('TOO_DARK');
  if (face.quality.sharpness < policy.minimumSharpness) return reject('TOO_BLURRY');
  return {
    accepted: true, code: 'ACCEPTED', message: 'Photo accepted.',
    policyVersion: PROFILE_PHOTO_POLICY_VERSION,
  };
}
