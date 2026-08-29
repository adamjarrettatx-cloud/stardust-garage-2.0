import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TEAM_VISIBLE_CATEGORIES,
  isTeamVisibleDocument,
  teamDocumentPath,
  contentDisposition,
  asciiSafeFilename,
} from '../lib/document-access.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('only SOPs are team-visible; the rest of the hub stays admin-only', () => {
  assert.deepEqual(TEAM_VISIBLE_CATEGORIES, ['sops']);

  assert.equal(isTeamVisibleDocument({ category: 'sops', status: 'active' }), true);
  for (const category of ['contracts', 'finance', 'vendor', 'marketing', 'team', 'other']) {
    assert.equal(
      isTeamVisibleDocument({ category, status: 'active' }),
      false,
      `${category} should not be team-visible`
    );
  }
});

test('team visibility requires a published SOP, not a draft or archived one', () => {
  assert.equal(isTeamVisibleDocument({ category: 'sops', status: 'draft' }), false);
  assert.equal(isTeamVisibleDocument({ category: 'sops', status: 'archived' }), false);
  assert.equal(isTeamVisibleDocument(null), false);
  assert.equal(isTeamVisibleDocument(undefined), false);
});

test('admin document links map to their team equivalent', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal(teamDocumentPath('/bananas/documents'), '/team/documents');
  assert.equal(teamDocumentPath('/bananas/documents/'), '/team/documents');
  assert.equal(teamDocumentPath(`/bananas/documents/${id}`), `/team/documents/${id}`);
  assert.equal(teamDocumentPath(`/bananas/documents/${id.toUpperCase()}`), `/team/documents/${id}`);
});

test('admin-only document tooling has no team equivalent', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal(teamDocumentPath('/bananas/documents/templates'), null);
  assert.equal(teamDocumentPath(`/bananas/documents/templates/${id}`), null);
  assert.equal(teamDocumentPath(`/bananas/documents/${id}/version`), null);
  assert.equal(teamDocumentPath('/bananas/financial-calendar'), null);
  assert.equal(teamDocumentPath('/bananas'), null);
  assert.equal(teamDocumentPath('/team/documents'), null);
});

test('content disposition escapes the filename and honours inline preview', () => {
  assert.equal(
    contentDisposition('opening-checklist.pdf', true),
    'inline; filename="opening-checklist.pdf"; filename*=UTF-8\'\'opening-checklist.pdf'
  );
  assert.match(contentDisposition('opening-checklist.pdf'), /^attachment; /);

  // A quote, backslash or newline in the filename must not be able to close the
  // quoted string or inject a second header.
  const hostile = contentDisposition('a"b\\c\r\nX-Evil: 1.pdf');
  assert.equal(hostile.includes('\r'), false);
  assert.equal(hostile.includes('\n'), false);
  assert.match(hostile, /filename="abcX-Evil: 1\.pdf"/);
});

test('asciiSafeFilename transliterates the characters that broke the View route', () => {
  // The live 500: a document titled with an em dash (U+2014). The quoted
  // `filename="..."` header param is Latin-1 only, so any code point > 255 made
  // new Response() throw a ByteString error and the whole view/download 500'd.
  assert.equal(
    asciiSafeFilename('Stardust Garage \u2014 Bassment Sessions Event Agreement.pdf'),
    'Stardust Garage - Bassment Sessions Event Agreement.pdf',
  );
  // Curly quotes transliterate to straight ones, and the double quote is then
  // dropped outright because it would close the quoted header param.
  assert.equal(asciiSafeFilename('\u201cQuoted\u201d \u2018name\u2019\u2026.pdf'), 'Quoted \'name\'....pdf');
  // Non-breaking / exotic spaces collapse rather than surviving as high bytes.
  assert.equal(asciiSafeFilename('a\u00a0b\u2009c.pdf'), 'a b c.pdf');
  // A stem with nothing ASCII left falls back to a generic name, keeping the ext.
  assert.equal(asciiSafeFilename('\u5168\u90e8\u4e2d\u6587.pdf'), 'document.pdf');
  assert.equal(asciiSafeFilename(''), 'document');
  assert.equal(asciiSafeFilename(null), 'document');
});

test('contentDisposition always produces a header new Response() accepts', () => {
  // This is the actual regression test for the 500: constructing the Response is
  // what used to throw, so assert on that rather than only on the string.
  for (const name of [
    'Stardust Garage \u2014 Bassment Sessions Event Agreement (PDF) (1).pdf',
    '\u5168\u90e8\u4e2d\u6587.pdf',
    '\ud83c\udf89 party rider.pdf',
    'plain.pdf',
  ]) {
    const header = contentDisposition(name, true);
    assert.doesNotThrow(
      () => new Response('x', { headers: { 'Content-Disposition': header } }),
      `header must be ByteString-safe for ${JSON.stringify(name)}`,
    );
    // Every byte of the quoted param is Latin-1 representable.
    const quoted = header.match(/filename="([^"]*)"/)[1];
    for (const ch of quoted) assert.ok(ch.codePointAt(0) <= 255, quoted);
    // The UTF-8 variant still carries the real name for clients that read it.
    assert.match(header, /filename\*=UTF-8''/);
  }
});

test('the middleware routes team members to SOPs instead of the calendar', () => {
  const middleware = fs.readFileSync(path.join(REPO_ROOT, 'middleware.js'), 'utf8');

  assert.match(middleware, /teamDocumentPath\(pathname\) \|\| '\/team\/calendar'/);
  // Non-team authenticated users still land on /member.
  assert.match(middleware, /url\.pathname = '\/member';/);
});

test('the team SOP routes gate on requireTeam and the SOP carve-out', () => {
  const files = [
    'app/team/documents/page.js',
    'app/team/documents/[id]/page.js',
    'app/api/team/documents/[id]/download/route.js',
  ];

  for (const relativePath of files) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(content, /requireTeam\(\)/, `${relativePath} must gate on requireTeam`);
    assert.match(
      content,
      /isTeamVisibleDocument|TEAM_VISIBLE_CATEGORIES/,
      `${relativePath} must restrict itself to team-visible documents`
    );
  }
});

test('the SOP RLS carve-out is select-only and scoped to published SOPs', () => {
  const sql = fs
    .readFileSync(path.join(REPO_ROOT, 'supabase/migrations/20260803_team_visible_sops.sql'), 'utf8')
    .replace(/^\s*--.*$/gm, '');

  for (const table of ['public.documents', 'public.document_versions', 'public.document_tags']) {
    assert.match(sql, new RegExp(`create policy \\w+ on ${table.replace('.', '\\.')}\\s+for select`));
  }
  assert.equal(/for\s+(insert|update|delete)/.test(sql), false, 'team policies must be select-only');
  assert.equal(/storage\.objects/.test(sql), false, 'team members must not get direct bucket access');
  assert.match(sql, /public\.is_team\(\)/);
});
