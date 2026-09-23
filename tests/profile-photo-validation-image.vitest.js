import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  normalizeProfilePhoto,
  ProfilePhotoImageError,
} from '@/lib/profile-photo-validation/image';

describe('profile photo normalization', () => {
  it('orients, bounds, converts, and strips metadata from the accepted snapshot', async () => {
    const input = await sharp({
      create: { width: 900, height: 600, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await normalizeProfilePhoto(input, 'image/jpeg');
    const metadata = await sharp(output.bytes).metadata();
    expect(output).toMatchObject({ width: 600, height: 900, mimeType: 'image/jpeg' });
    expect(output.bytes.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(metadata).toMatchObject({ format: 'jpeg', width: 600, height: 900 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it('limits the longest edge without enlarging acceptable input', async () => {
    const large = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: 'white' },
    }).png().toBuffer();
    expect(await normalizeProfilePhoto(large, 'image/png')).toMatchObject({ width: 1600, height: 800 });
  });

  it('rejects a declared MIME that disagrees with decoded bytes', async () => {
    const png = await sharp({
      create: { width: 500, height: 500, channels: 3, background: 'white' },
    }).png().toBuffer();
    await expect(normalizeProfilePhoto(png, 'image/jpeg')).rejects.toMatchObject({
      code: 'MIME_MISMATCH', status: 415,
    });
  });

  it('rejects unsupported SVG bytes rather than converting them', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"/>');
    await expect(normalizeProfilePhoto(svg, 'image/svg+xml')).rejects.toBeInstanceOf(ProfilePhotoImageError);
  });

  it('rejects a low-resolution source after normalization', async () => {
    const small = await sharp({
      create: { width: 319, height: 600, channels: 3, background: 'white' },
    }).jpeg().toBuffer();
    await expect(normalizeProfilePhoto(small, 'image/jpeg')).rejects.toMatchObject({
      code: 'IMAGE_TOO_SMALL', status: 422,
    });
  });
});
