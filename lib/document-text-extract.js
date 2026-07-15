// Dependency-free plain-text extraction for uploaded documents.
//
// Runs at upload time (Node.js runtime) so a document's body text can be folded
// into documents.search_tsv and become keyword-searchable. Deliberately has no
// third-party dependencies: OOXML files (.docx) are ZIP archives we can inflate
// with the built-in zlib, and text-based formats decode directly. PDF text is
// extracted best-effort from content-stream string operators.
//
// This is best-effort by design. Scanned/image-only PDFs, unusual font
// encodings, and password-protected files yield little or no text — that is
// acceptable: the title/description/tags remain searchable regardless.

import zlib from 'node:zlib';

// Cap extracted text so a pathological file can't bloat the tsvector / row.
export const MAX_EXTRACTED_CHARS = 1_000_000;

const OOXML_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
]);

const TEXT_MIMES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
]);

function extLower(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(filename || '');
  return m ? m[1].toLowerCase() : '';
}

function clamp(text) {
  const trimmed = (text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return trimmed.length > MAX_EXTRACTED_CHARS ? trimmed.slice(0, MAX_EXTRACTED_CHARS) : trimmed;
}

// --------------------------------------------------------------------------
// ZIP reader (enough of the format to pull named entries out of an OOXML file)
// --------------------------------------------------------------------------

// Locate the End Of Central Directory record and return { offset, count } of
// the central directory, or null if this isn't a well-formed zip.
function findEocd(buf) {
  const EOCD_SIG = 0x06054b50;
  // EOCD is 22 bytes minimum and lives at the end; the trailing comment can be
  // up to 65535 bytes, so scan backwards over that window.
  const minPos = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      return {
        count: buf.readUInt16LE(i + 10),
        cdOffset: buf.readUInt32LE(i + 16),
      };
    }
  }
  return null;
}

// Read a single named entry from a zip buffer. Returns a Buffer or null.
function readZipEntry(buf, name) {
  const eocd = findEocd(buf);
  if (!eocd) return null;

  const CDH_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;
  let p = eocd.cdOffset;

  for (let i = 0; i < eocd.count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (entryName === name) {
      if (buf.readUInt32LE(localOffset) !== LFH_SIG) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(data);        // stored
      if (method === 8) return zlib.inflateRawSync(data); // deflate
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// --------------------------------------------------------------------------
// Format-specific extractors
// --------------------------------------------------------------------------

function xmlToText(xml) {
  return xml
    // paragraph / row / break boundaries become newlines so words don't fuse
    .replace(/<\/w:p>|<\/a:p>|<w:br\/?>|<w:tab\/?>|<\/text:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

export function extractDocxText(buf) {
  // Word puts the main body in word/document.xml. Headers/footers live in
  // separate parts; the body covers the vast majority of searchable content.
  const doc = readZipEntry(buf, 'word/document.xml');
  if (!doc) return '';
  return xmlToText(doc.toString('utf8'));
}

// Generic OOXML: docx uses word/document.xml; xlsx/pptx spread text across many
// parts. We pull the obvious body part per type and fall back to sharedStrings
// for spreadsheets.
export function extractOoxmlText(buf, filename) {
  const ext = extLower(filename);
  if (ext === 'xlsx') {
    const shared = readZipEntry(buf, 'xl/sharedStrings.xml');
    return shared ? xmlToText(shared.toString('utf8')) : '';
  }
  if (ext === 'pptx') {
    // Slides are pptx/slides/slideN.xml — best-effort: concatenate the first
    // handful so common decks stay searchable without unbounded work.
    let out = '';
    for (let i = 1; i <= 50; i++) {
      const slide = readZipEntry(buf, `ppt/slides/slide${i}.xml`);
      if (!slide) break;
      out += xmlToText(slide.toString('utf8')) + '\n';
    }
    return out;
  }
  return extractDocxText(buf);
}

// Legacy .doc (application/msword) is a binary OLE compound file. A full parser
// is out of scope; we scavenge runs of printable ASCII, which recovers most of
// the prose for plain memos. Best-effort only.
export function extractLegacyDocText(buf) {
  const ascii = buf.toString('latin1');
  const runs = ascii.match(/[\x20-\x7e]{4,}/g) || [];
  return runs.join(' ');
}

// Decode a PDF literal string, resolving escape sequences and octal codes.
function decodePdfLiteral(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (n === undefined) break;
      if (n === 'n') { out += '\n'; i++; }
      else if (n === 'r') { out += '\r'; i++; }
      else if (n === 't') { out += '\t'; i++; }
      else if (n === 'b') { out += '\b'; i++; }
      else if (n === 'f') { out += '\f'; i++; }
      else if (n === '(' || n === ')' || n === '\\') { out += n; i++; }
      else if (n >= '0' && n <= '7') {
        let oct = n; i++;
        for (let k = 0; k < 2 && s[i + 1] >= '0' && s[i + 1] <= '7'; k++) { oct += s[++i]; }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (n === '\n') { i++; } // line continuation
      else { out += n; i++; }
    } else {
      out += c;
    }
  }
  return out;
}

// Pull text out of a decoded PDF content stream by reading the string operands
// of text-showing operators: (str)Tj, [ ... ]TJ, (str)' and (str)".
function textFromContentStream(content) {
  let out = '';
  const len = content.length;
  let i = 0;
  while (i < len) {
    const ch = content[i];
    if (ch === '(') {
      // literal string, honoring balanced parens and escaped parens
      let depth = 1; let j = i + 1; let raw = '';
      while (j < len && depth > 0) {
        const cj = content[j];
        if (cj === '\\') { raw += cj + (content[j + 1] || ''); j += 2; continue; }
        if (cj === '(') depth++;
        else if (cj === ')') { depth--; if (depth === 0) break; }
        raw += cj; j++;
      }
      out += decodePdfLiteral(raw);
      i = j + 1;
    } else if (ch === '<' && content[i + 1] !== '<') {
      // hex string <48656c6c6f>
      let j = i + 1; let hex = '';
      while (j < len && content[j] !== '>') { hex += content[j]; j++; }
      hex = hex.replace(/\s+/g, '');
      if (hex.length % 2) hex += '0';
      for (let k = 0; k < hex.length; k += 2) {
        const code = parseInt(hex.substr(k, 2), 16);
        if (!Number.isNaN(code)) out += String.fromCharCode(code);
      }
      i = j + 1;
    } else if (ch === ']' || ch === '\n' || ch === '\r') {
      // array/line boundaries → soft space so tokens don't glue together
      if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
      i++;
    } else {
      i++;
    }
  }
  return out;
}

export function extractPdfText(buf) {
  const raw = buf.toString('latin1');
  let text = '';
  const streamRe = /stream\r?\n?/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const dictStart = raw.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : '';
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let body = raw.slice(start, end);
    // trim trailing EOL that precedes endstream
    body = body.replace(/\r?\n?$/, '');

    let content = '';
    if (/\/FlateDecode/.test(dict)) {
      try {
        content = zlib.inflateSync(Buffer.from(body, 'latin1')).toString('latin1');
      } catch {
        content = ''; // encrypted / non-flate / truncated — skip this stream
      }
    } else if (!/\/(DCTDecode|CCITTFaxDecode|JPXDecode|JBIG2Decode|Image)/.test(dict)) {
      content = body; // uncompressed content stream
    }
    if (content && /BT|Tj|TJ/.test(content)) {
      text += textFromContentStream(content) + '\n';
    }
    streamRe.lastIndex = end + 'endstream'.length;
  }
  return text;
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

// Extract searchable plain text from an uploaded file buffer. Never throws —
// extraction is a best-effort enrichment and must not break an upload.
export function extractText(buf, mimeType, filename) {
  if (!buf || !buf.length) return '';
  const mime = (mimeType || '').toLowerCase();
  const ext = extLower(filename);
  try {
    if (mime === 'application/pdf' || ext === 'pdf') return clamp(extractPdfText(buf));
    if (OOXML_MIMES.has(mime) || ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
      return clamp(extractOoxmlText(buf, filename));
    }
    if (mime === 'application/msword' || ext === 'doc') return clamp(extractLegacyDocText(buf));
    if (TEXT_MIMES.has(mime) || ext === 'txt' || ext === 'csv' || ext === 'md') {
      return clamp(buf.toString('utf8'));
    }
  } catch (err) {
    console.error('[extractText] extraction failed', { mime, filename, err: err?.message });
    return '';
  }
  return ''; // images, zip, unknown — nothing textual to index
}
