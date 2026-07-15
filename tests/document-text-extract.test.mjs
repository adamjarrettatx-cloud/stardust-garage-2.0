import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractText,
  extractDocxText,
  extractPdfText,
} from '../lib/document-text-extract.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');

// --- Minimal, spec-valid ZIP builder (so DOCX fixtures are real files) -------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Build a zip from { name -> Buffer } using DEFLATE, exercising the inflate path.
function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(content);
    const crc = crc32(content);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8); // deflate
    lfh.writeUInt32LE(0, 10); // time/date
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(content.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    locals.push(lfh, nameBuf, comp);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(0, 12);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(content.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const localBuf = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, cdBuf, eocd]);
}

function buildDocx(paragraphs) {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join('');
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  return buildZip({
    '[Content_Types].xml': Buffer.from(contentTypes, 'utf8'),
    'word/document.xml': Buffer.from(documentXml, 'utf8'),
  });
}

// Build a tiny single-page PDF whose content stream shows `text`.
// `flate` toggles FlateDecode compression to exercise both code paths.
function buildPdf(text, { flate = false } = {}) {
  const streamContent = `BT /F1 12 Tf 72 720 Td (${text.replace(/([()\\])/g, '\\$1')}) Tj ET`;
  const streamBuf = Buffer.from(streamContent, 'latin1');
  const body = flate ? zlib.deflateSync(streamBuf) : streamBuf;
  const dict = flate
    ? `<< /Length ${body.length} /Filter /FlateDecode >>`
    : `<< /Length ${body.length} >>`;

  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
  ];
  const header = Buffer.from('%PDF-1.4\n', 'latin1');
  const parts = [header, ...objs.map((o) => Buffer.from(o, 'latin1'))];
  const obj4 = Buffer.concat([
    Buffer.from(`4 0 obj\n${dict}\nstream\n`, 'latin1'),
    body,
    Buffer.from(`\nendstream\nendobj\n`, 'latin1'),
  ]);
  parts.push(obj4);
  parts.push(Buffer.from(`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`, 'latin1'));
  parts.push(Buffer.from(`%%EOF`, 'latin1'));
  return Buffer.concat(parts);
}

// --- DOCX -------------------------------------------------------------------
test('extractDocxText pulls paragraph text from a real docx zip', () => {
  const buf = buildDocx(['Standard Operating Procedure', 'Espresso calibration protocol PORTAFILTER']);
  const text = extractDocxText(buf);
  assert.match(text, /Standard Operating Procedure/);
  assert.match(text, /PORTAFILTER/);
});

test('extractText routes docx by mime type', () => {
  const buf = buildDocx(['Opening checklist ZEBRA-SECRET']);
  const text = extractText(
    buf,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'opening.docx',
  );
  assert.match(text, /ZEBRA-SECRET/);
});

test('extractText decodes XML entities in docx', () => {
  const buf = buildDocx(['Cash &amp; register &lt;handoff&gt;']);
  const text = extractDocxText(buf);
  assert.match(text, /Cash & register <handoff>/);
});

// --- PDF --------------------------------------------------------------------
test('extractPdfText reads an uncompressed content stream', () => {
  const buf = buildPdf('Closing procedure WALRUS-TOKEN');
  const text = extractPdfText(buf);
  assert.match(text, /WALRUS-TOKEN/);
});

test('extractPdfText reads a FlateDecode content stream', () => {
  const buf = buildPdf('Inventory count FLATE-NARWHAL', { flate: true });
  const text = extractText(buf, 'application/pdf', 'inventory.pdf');
  assert.match(text, /FLATE-NARWHAL/);
});

// --- plain text + guards ----------------------------------------------------
test('extractText handles plain text and csv', () => {
  assert.match(extractText(Buffer.from('hello WORLD'), 'text/plain', 'a.txt'), /WORLD/);
  assert.match(extractText(Buffer.from('sku,name\n1,widget'), 'text/csv', 'a.csv'), /widget/);
});

test('extractText returns empty for images and unknown types without throwing', () => {
  assert.equal(extractText(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', 'x.jpg'), '');
  assert.equal(extractText(Buffer.alloc(0), 'application/pdf', 'empty.pdf'), '');
  assert.equal(extractText(Buffer.from('garbage'), 'application/zip', 'x.zip'), '');
});

// --- Fixtures on disk match what the extractor reads ------------------------
test('committed SOP fixtures extract their body keyword', () => {
  const docx = fs.readFileSync(path.join(FIXTURES, 'sop-sample.docx'));
  const pdf = fs.readFileSync(path.join(FIXTURES, 'sop-sample.pdf'));
  assert.match(
    extractText(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'sop-sample.docx'),
    /GRIDLOCK-DOCX/,
  );
  assert.match(extractText(pdf, 'application/pdf', 'sop-sample.pdf'), /GRIDLOCK-PDF/);
});

// Regenerate the committed fixtures when run directly:  node tests/document-text-extract.test.mjs --write-fixtures
if (process.argv.includes('--write-fixtures')) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURES, 'sop-sample.docx'),
    buildDocx([
      'Stardust Garage — Standard Operating Procedure',
      'Opening checklist and espresso machine calibration.',
      'Distinctive body keyword: GRIDLOCK-DOCX (title does not contain this).',
    ]),
  );
  fs.writeFileSync(
    path.join(FIXTURES, 'sop-sample.pdf'),
    buildPdf('Stardust Garage SOP closing procedure GRIDLOCK-PDF', { flate: true }),
  );
  console.log('fixtures written to', FIXTURES);
}
