import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  buildTemplateStoragePath,
  readPdfMeta,
  businessValueText,
  bakeBusinessFields,
} from '../lib/template-helpers.js';
import { buildSignNowFields } from '../lib/contract-fields.js';

async function makePdf(pages = [[612, 792]]) {
  const pdf = await PDFDocument.create();
  for (const [w, h] of pages) pdf.addPage([w, h]);
  return Buffer.from(await pdf.save());
}

test('buildTemplateStoragePath is namespaced + sanitized', () => {
  const p = buildTemplateStoragePath('tid', 'My Contract!.pdf', 'uid1');
  assert.equal(p, 'templates/tid/uid1-My_Contract_.pdf');
});

test('readPdfMeta returns page count + sizes', async () => {
  const meta = await readPdfMeta(await makePdf([[612, 792], [792, 612]]));
  assert.equal(meta.pageCount, 2);
  assert.equal(meta.pages[0].width, 612);
  assert.equal(meta.pages[0].height, 792);
  assert.equal(meta.pages[1].width, 792);
});

test('readPdfMeta returns null for non-PDF bytes', async () => {
  assert.equal(await readPdfMeta(Buffer.from('not a pdf')), null);
});

test('businessValueText handles checkbox + text', () => {
  assert.equal(businessValueText({ type: 'checkbox' }, true), 'X');
  assert.equal(businessValueText({ type: 'checkbox' }, 'on'), 'X');
  assert.equal(businessValueText({ type: 'checkbox' }, false), '');
  assert.equal(businessValueText({ type: 'text' }, '  hi  '), 'hi');
  assert.equal(businessValueText({ type: 'text' }, null), '');
});

test('bakeBusinessFields returns a valid, larger PDF when a value is stamped', async () => {
  const base = await makePdf();
  const layout = [
    { id: 'f_a', type: 'text', assigned_to: 'business', page_number: 0, x: 50, y: 700, width: 200, height: 20, required: true },
    { id: 'f_b', type: 'signature', assigned_to: 'signer_1', page_number: 0, x: 50, y: 100, width: 200, height: 40, required: true },
  ];
  const out = await bakeBusinessFields({ pdfBuffer: base, fieldLayout: layout, fieldValues: { f_a: 'Acme LLC' } });
  const reloaded = await PDFDocument.load(out);
  assert.equal(reloaded.getPageCount(), 1);
  assert.ok(out.length > base.length, 'baked PDF should carry the stamped text');
});

test('bakeBusinessFields with no business fields returns a valid PDF', async () => {
  const base = await makePdf();
  const out = await bakeBusinessFields({ pdfBuffer: base, fieldLayout: [], fieldValues: {} });
  const reloaded = await PDFDocument.load(out);
  assert.equal(reloaded.getPageCount(), 1);
});

test('buildSignNowFields emits only signer fields with numbered roles', () => {
  const layout = [
    { id: 'f_a', type: 'text', assigned_to: 'business', page_number: 0, x: 50, y: 700, width: 200, height: 20, required: true },
    { id: 'f_b', type: 'signature', assigned_to: 'signer_1', page_number: 0, x: 50, y: 100, width: 200, height: 40, required: true },
    { id: 'f_c', type: 'text', assigned_to: 'signer_2', page_number: 0, x: 50, y: 60, width: 200, height: 20, required: false },
  ];
  const fields = buildSignNowFields(layout, [{ width: 612, height: 792 }]);
  assert.equal(fields.length, 2);
  assert.deepEqual(fields.map((f) => f.role), ['Signer 1', 'Signer 2']);
  assert.equal(fields[0].type, 'signature');
  assert.equal(fields[0].name, 'f_b');
  assert.equal(fields[1].required, false);
});
