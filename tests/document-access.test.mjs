import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TEAM_VISIBLE_CATEGORIES,
  isTeamVisibleDocument,
  teamDocumentPath,
  contentDisposition,
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
