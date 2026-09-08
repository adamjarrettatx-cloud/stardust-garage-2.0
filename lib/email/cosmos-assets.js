// Cached brand assets rendered as PNGs for embedding in emails via CID.
//
// Email clients (Gmail, Outlook, Apple Mail) strip inline <svg>, refuse
// data: URIs in <img> tags, and treat CSS gradients unreliably. The site's
// live starfield is a JS-animated SVG that renders in exactly zero email
// clients. So we bake the cosmos background and the white wordmark into
// static PNGs and attach them per email via CID.
//
// Both PNGs are rendered ONCE per process. sharp keeps them in memory as
// Buffers; every email send just re-references the same Buffer inside its
// attachments array. No filesystem I/O per send, no per-recipient render.
// If the process crashes or Vercel spins up a fresh Lambda, they're
// re-rendered on first use.
//
// The cosmos PNG intentionally matches the site's radial gradient +
// three-layer white starfield (see app/components/CosmosBackground.js).
// Star positions are a deterministic sample of the same coordinate set,
// so subscribers who visit the site immediately after opening the email
// see a familiar visual language, not a random look-alike.

import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Rendered lazily on first request; then reused for the process lifetime.
let heroPromise = null;

// Combined hero: cosmos band + white wordmark centered over it, baked into
// a single PNG that every email client can render as one <img>. 600px wide
// (matches the standard email card width), 300px tall (a proportional hero
// band that leaves room for the receipt content underneath).
export function getHeroPngBuffer() {
  if (!heroPromise) heroPromise = renderHeroPng();
  return heroPromise;
}

async function renderHeroPng() {
  const width = 600;
  const height = 300;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="cosmos" cx="50%" cy="20%" r="90%">
      <stop offset="0%" stop-color="#141428"/>
      <stop offset="55%" stop-color="#0a0a14"/>
      <stop offset="100%" stop-color="#050510"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#cosmos)"/>
  ${renderHeroStars().join('')}
</svg>`;
  // Rasterize cosmos band
  const cosmosBuf = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  // Load wordmark svg, resize to fit inside the band (about 55% width)
  const svgPath = path.join(process.cwd(), 'public', 'logos', 'wordmark-white.svg');
  const wordmarkSvg = await fs.readFile(svgPath);
  const wordmarkBuf = await sharp(wordmarkSvg)
    .resize({ width: 330 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  // Composite wordmark centered on cosmos
  return sharp(cosmosBuf)
    .composite([{ input: wordmarkBuf, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Hero-band stars: brighter and denser than the tall cosmos, since the
// band is only 300px tall and viewers see it all at once.
function renderHeroStars() {
  const out = [];
  // Tiny stars scattered across the band
  const tinys = [
    { x: 40, y: 40 }, { x: 95, y: 90 }, { x: 160, y: 30 }, { x: 220, y: 75 },
    { x: 280, y: 25 }, { x: 340, y: 80 }, { x: 400, y: 35 }, { x: 470, y: 65 },
    { x: 540, y: 30 }, { x: 570, y: 90 },
    { x: 25, y: 130 }, { x: 80, y: 170 }, { x: 145, y: 145 }, { x: 205, y: 180 },
    { x: 265, y: 155 }, { x: 320, y: 195 }, { x: 385, y: 135 }, { x: 445, y: 175 },
    { x: 505, y: 150 }, { x: 555, y: 180 },
    { x: 55, y: 220 }, { x: 115, y: 260 }, { x: 175, y: 235 }, { x: 240, y: 270 },
    { x: 300, y: 245 }, { x: 360, y: 275 }, { x: 420, y: 225 }, { x: 480, y: 265 },
    { x: 530, y: 240 }, { x: 585, y: 275 },
  ];
  for (const s of tinys) {
    out.push(`<circle cx="${s.x}" cy="${s.y}" r="0.8" fill="#ffffff" opacity="0.75"/>`);
  }
  // Small stars
  const smalls = [
    { x: 70, y: 60 }, { x: 250, y: 100 }, { x: 430, y: 50 }, { x: 520, y: 120 },
    { x: 130, y: 210 }, { x: 380, y: 200 }, { x: 90, y: 275 }, { x: 450, y: 260 },
  ];
  for (const s of smalls) {
    out.push(`<circle cx="${s.x}" cy="${s.y}" r="1.4" fill="#ffffff" opacity="0.9"/>`);
  }
  // Bright stars with glow
  const brights = [
    { x: 180, y: 55 }, { x: 500, y: 210 }, { x: 300, y: 260 }, { x: 60, y: 200 },
  ];
  for (const s of brights) {
    out.push(`<circle cx="${s.x}" cy="${s.y}" r="4" fill="#ffffff" opacity="0.14"/>`);
    out.push(`<circle cx="${s.x}" cy="${s.y}" r="1.8" fill="#ffffff" opacity="0.95"/>`);
  }
  return out;
}


