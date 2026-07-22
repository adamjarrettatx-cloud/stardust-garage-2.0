// Server-only helpers for contract templates + the send-time PDF preparation.
// Uses pdf-lib (pure JS, no native deps) to read page geometry and to bake the
// staff-entered "business" field values permanently into the PDF before it is
// uploaded to SignNow. NEVER import this from a client component.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { businessFields, isBusinessRole } from './contract-fields.js';

export const TEMPLATE_MIME = 'application/pdf';

// Deterministic storage path for a template PDF, namespaced away from the
// per-document uploads. Mirrors buildStoragePath's sanitize-and-uuid approach.
export function buildTemplateStoragePath(templateId, filename, uid) {
  const safe = String(filename || 'template.pdf')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  const id = uid || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);
  return `templates/${templateId}/${id}-${safe}`;
}

// Read page count + per-page {width,height} in PDF points. Returns null if the
// bytes aren't a parseable PDF (caller rejects with a clear message).
export async function readPdfMeta(buffer) {
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = pdf.getPages().map((p) => {
      const { width, height } = p.getSize();
      return { width, height };
    });
    return { pageCount: pages.length, pages };
  } catch {
    return null;
  }
}

// Render a business value as the text to stamp onto the PDF. Checkboxes stamp an
// "X" when truthy (and nothing when unchecked); everything else stamps the
// trimmed string value.
export function businessValueText(field, rawValue) {
  if (field.type === 'checkbox') {
    const on = rawValue === true || rawValue === 'true' || rawValue === 'on' || rawValue === '1' || rawValue === 1;
    return on ? 'X' : '';
  }
  if (rawValue == null) return '';
  return String(rawValue).trim();
}

// Pick a font size that keeps `text` within `maxWidth` points, stepping down
// from `startSize` but never below `minSize`.
function fitFontSize(font, text, maxWidth, startSize, minSize) {
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

// Bake every `assigned_to: 'business'` field's value directly onto the PDF at
// its stored (bottom-left, points) coordinates, producing a new "prepared" PDF.
// pdf-lib's coordinate space IS the stored space, so no transform is needed.
// Returns a Uint8Array of the prepared PDF. Fields with an empty value are
// skipped. Unknown pages are ignored defensively.
export async function bakeBusinessFields({ pdfBuffer, fieldLayout = [], fieldValues = {} }) {
  const fields = businessFields(fieldLayout);
  const pdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  if (fields.length === 0) return await pdf.save();

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const ink = rgb(0.05, 0.05, 0.05);

  for (const f of fields) {
    if (!isBusinessRole(f.assigned_to)) continue;
    const page = pages[f.page_number];
    if (!page) continue;
    const text = businessValueText(f, fieldValues?.[f.id]);
    if (!text) continue;

    // Vertically center a single line inside the box; clamp the size so long
    // values stay inside the field width. 11pt default per the spec.
    const size = fitFontSize(font, text, Math.max(f.width - 4, 8), 11, 6);
    const textHeight = font.heightAtSize(size);
    const baselineY = f.y + Math.max((f.height - textHeight) / 2, 0) + size * 0.12;
    page.drawText(text, {
      x: f.x + 2,
      y: baselineY,
      size,
      font,
      color: ink,
      maxWidth: Math.max(f.width - 4, 8),
      lineHeight: size * 1.1,
    });
  }

  return await pdf.save();
}
