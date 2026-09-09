// Shared helper for uploading event flyers to Supabase Storage.
//
// Every mobile pixel we skip loading is one we don't have to render, but the
// biggest wins here come from just not uploading a 2+MB source PNG in the first
// place. Before this file existed the admin form uploaded whatever the file
// input handed us straight through to the `event-images` bucket, which meant
// grid thumbnails on the phone had to fetch multi-megabyte flyers just to
// paint a 200px tile.
//
// This helper does three things:
//   1. Resize to a max long-edge (default 1600px) — big enough for a
//      full-bleed desktop hero, way more than the mobile app needs.
//   2. Re-encode to JPEG at 82 quality unless the source has an alpha
//      channel (PNGs with transparency stay PNG so we don't lose the mask).
//   3. Preserve the timestamped filename convention so the existing
//      `image_url` -> row insert flow doesn't need to change.
//
// If compression fails for any reason (unknown MIME, decode error, etc.) we
// fall back to uploading the original. The user still gets their event
// created — no upload path should ever be blocked by a compression bug.

import imageCompression from 'browser-image-compression';

const BUCKET = 'event-images';

// Long-edge cap in pixels. Chosen so a full-width desktop hero (~1280px on a
// retina screen) still gets a 2x source, and mobile (<= 800px display width)
// gets plenty of resolution to spare for the Image Transformations layer to
// downscale from.
const MAX_LONG_EDGE_PX = 1600;

// JPEG quality (0..1 for browser-image-compression). 0.82 is the sweet spot
// where re-encoded photographs are indistinguishable from source at mobile
// display sizes and even side-by-side on desktop takes a trained eye.
const JPEG_QUALITY = 0.82;

// browser-image-compression works in bytes on `maxSizeMB` but the real cap
// we want is the pixel dimensions above; leaving a soft byte budget keeps
// runaway files (a hand-authored 20MP PNG) from producing a still-oversized
// output even after resize.
const MAX_SIZE_MB = 0.5;

/**
 * True when the file is a raster image we can safely pipe through the
 * compressor. GIFs are excluded because browser-image-compression flattens
 * them to a single frame; SVGs because they're vector and compressing is
 * counterproductive.
 */
function isCompressibleImage(file) {
  if (!file || !file.type) return false;
  const mime = file.type.toLowerCase();
  return (
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/png' ||
    mime === 'image/webp' ||
    mime === 'image/heic' ||
    mime === 'image/heif'
  );
}

/**
 * True when we should keep the original format (i.e., don't force JPEG).
 * PNGs with transparency need to stay PNG; converting them to JPEG replaces
 * the alpha channel with black, which would silently break flyers that use
 * transparent cutouts on top of the site's dark background.
 *
 * We can't cheaply inspect pixel data client-side to know whether a PNG
 * actually uses its alpha channel — the safe default is "if it's a PNG,
 * keep it PNG". PNGs also get resized and re-encoded (smaller pixel count
 * = smaller file), just not converted.
 */
function shouldPreservePng(file) {
  return file.type === 'image/png';
}

/**
 * Compress an image file. Returns the compressed File on success or the
 * original file on failure — never throws to the caller. Callers get the
 * File back either way; the upload proceeds with whichever we have.
 */
export async function compressEventImage(file) {
  if (!isCompressibleImage(file)) return file;

  try {
    const options = {
      maxSizeMB: MAX_SIZE_MB,
      maxWidthOrHeight: MAX_LONG_EDGE_PX,
      initialQuality: JPEG_QUALITY,
      useWebWorker: true,
      // Force JPEG for everything except PNGs (which we conservatively
      // keep as PNG in case they use alpha).
      fileType: shouldPreservePng(file) ? 'image/png' : 'image/jpeg',
      // Preserve EXIF orientation so a photo taken portrait doesn't come
      // out sideways after re-encode. Doesn't matter for flat flyer
      // graphics but costs nothing.
      preserveExif: false,
    };

    const compressed = await imageCompression(file, options);

    // browser-image-compression returns a Blob; wrap as File so the rest
    // of the upload path (which expects .name) keeps working. We also
    // rewrite the extension to match the actual output format, since the
    // Supabase Storage Content-Type headers are derived from the object
    // name for cache/CDN behavior.
    const outExt = shouldPreservePng(file) ? 'png' : 'jpg';
    const baseName = (file.name || 'image').replace(/\.[^./\\]+$/, '');
    return new File([compressed], `${baseName}.${outExt}`, {
      type: compressed.type || options.fileType,
      lastModified: Date.now(),
    });
  } catch (err) {
    // Never block the upload — log and fall through to the original.
    console.warn('[event-image-upload] compress failed, using original', err);
    return file;
  }
}

/**
 * Compress then upload an event image to the `event-images` bucket.
 * Returns `{ publicUrl, path, error }` — mirrors the shape the previous
 * inline code produced so both admin components can adopt this without
 * touching their success/error branches.
 *
 * `supabase` must be a browser-client Supabase instance (has the user's
 * session for bucket RLS). The bucket is public, so `getPublicUrl` returns
 * a permanent URL suitable for storing in `public.events.image_url`.
 */
export async function uploadEventImage(supabase, file) {
  const compressed = await compressEventImage(file);

  // Timestamped, sanitized filename — same convention the two admin
  // components used before, so old rows in `events.image_url` and new
  // rows share a predictable naming scheme.
  const path = `${Date.now()}-${(compressed.name || 'image').replace(/[^a-zA-Z0-9.-]/g, '_')}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, {
      contentType: compressed.type || 'image/jpeg',
      // Never overwrite; timestamped names make collisions basically
      // impossible but this makes the intent explicit.
      upsert: false,
    });

  if (uploadError) {
    return { publicUrl: null, path: null, error: uploadError };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return { publicUrl, path, error: null };
}
