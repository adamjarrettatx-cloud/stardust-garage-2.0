// Shared type-only contract. Contains no credentials or detector implementation.
// Runtime request validation and context authorization belong to the next
// integration milestone; these types do not constitute authorization.
export type PhotoContext = 'account' | 'trial_pass' | 'application' | 'partner';
export type UploadState =
  | 'created' | 'processing' | 'accepted' | 'rejected'
  | 'retryable_error' | 'expired';

export type PhotoRejectionCode =
  | 'NO_FACE' | 'MULTIPLE_FACES' | 'UNCERTAIN_FACE' | 'FACE_TOO_SMALL'
  | 'FACE_OBSCURED' | 'FACE_ANGLE' | 'TOO_DARK' | 'TOO_BLURRY';

export type PhotoDecision =
  | { accepted: true; code: 'ACCEPTED'; message: string; policyVersion: string }
  | { accepted: false; code: PhotoRejectionCode; message: string; policyVersion: string };

export interface ImageDimensions { width: number; height: number }

/** Provider-neutral normalized face record, with no identity/demographic data. */
export interface DetectedFace {
  confidence: number;
  box: { width: number; height: number; left: number; top: number };
  pose: { yaw: number; pitch: number; roll: number };
  quality: { brightness: number; sharpness: number };
  occlusion: { occluded: boolean; confidence: number };
}

export interface FaceDetectionResult {
  faces: DetectedFace[];
  provider: 'aws_rekognition';
  // Do not persist raw responses, landmarks, or demographic predictions.
}

export type FaceDetector = (
  imageBytes: Uint8Array,
  options?: { signal?: AbortSignal },
) => Promise<FaceDetectionResult>;

export interface UploadInitiationRequest {
  context: PhotoContext;
  mimeType: string;
  byteSize: number;
  noticeVersion: string;
}

export interface AcceptedPhotoResponse {
  ok: true;
  uploadId: string;
  photoId: string;
  status: 'accepted';
  attached: boolean;
  acceptanceKind: 'auto_passed' | 'manual_approved';
  policyVersion: string;
  uploadedAt: string;
  signedUrl: string | null;
  signedUrlExpiresAt: string | null;
}

export interface PhotoErrorResponse {
  ok: false;
  uploadId?: string;
  code: string;
  error: string;
  retryable: boolean;
  canChooseAnother: boolean;
  canRequestReview: boolean;
  requestId: string;
}
