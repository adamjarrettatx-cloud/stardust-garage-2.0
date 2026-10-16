// SERVER ONLY. Staff email invites and private staff photos.
import { randomBytes, randomUUID } from "node:crypto";
import { ClockError, hash } from "./server";
import { resolveSiteUrl } from "@/lib/site-url";
import {
  PROFILE_PHOTO_BUCKET,
  ALLOWED_PROFILE_PHOTO_MIME,
  extForMime,
  createProfilePhotoSignedUrls,
} from "@/lib/profile-photo";

export const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const newInviteToken = () => randomBytes(32).toString("base64url");
export const inviteHash = (token) => hash("staff-invite", token);
export const STAFF_PHOTO_MAX_BYTES = 4 * 1024 * 1024; // under the 4.5 MB function body limit

export function setupUrl(request, token) {
  return `${resolveSiteUrl(request)}/employee/setup?token=${encodeURIComponent(token)}`;
}

export function validStaffPhoto(file) {
  if (!file || typeof file === "string") throw new ClockError("Add a photo of yourself.");
  if (!ALLOWED_PROFILE_PHOTO_MIME.includes(file.type))
    throw new ClockError("Use a JPEG, PNG, WebP or HEIC photo.", 415);
  if (file.size > STAFF_PHOTO_MAX_BYTES) throw new ClockError("That photo is too large. Choose one under 4 MB.", 413);
  if (file.size < 1024) throw new ClockError("That photo appears empty. Try again.");
  return file;
}

// Private bucket, opaque per-upload object name under the staff profile.
// Never under a user-id prefix, so account-photo ownership rules never apply.
export async function uploadStaffPhoto(client, workerId, file) {
  const path = `staff/${workerId}/${randomUUID()}.${extForMime(file.type)}`;
  const { error } = await client.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new ClockError("Could not save your photo. Nothing was changed. Try again.", 503);
  return path;
}
export async function removeStaffPhoto(client, path) {
  if (!path || !path.startsWith("staff/")) return;
  await client.storage.from(PROFILE_PHOTO_BUCKET).remove([path]).catch(() => {});
}
export async function staffPhotoUrls(client, paths) {
  return createProfilePhotoSignedUrls(client, paths.filter((p) => p?.startsWith("staff/")));
}
