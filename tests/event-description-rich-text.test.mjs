import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeEventDescriptionHtml } from '../lib/rich-text.js';
import { htmlToPlainText, plainTextToEditorHtml } from '../lib/rich-text-plain.js';

test('sanitizer keeps allowed formatting and normalizes browser tags', () => {
  const out = sanitizeEventDescriptionHtml('<div><b>Bold</b> <i>it</i> <u>u</u> <strike>s</strike></div>');
  assert.equal(out, '<p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s></p>');
});

test('sanitizer strips scripts, handlers, styles and unsafe links', () => {
  const out = sanitizeEventDescriptionHtml(
    '<p onclick="x()" style="color:red">Hi<script>alert(1)</script><img src=x onerror=alert(1)>' +
      '<a href="javascript:alert(1)">bad</a> <a href="https://sdgatx.com">ok</a></p>'
  );
  assert.doesNotMatch(out, /script|onclick|onerror|style=|<img|javascript:/i);
  assert.match(out, /<a href="https:\/\/sdgatx\.com" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
});

test('an emptied editor sanitizes to empty', () => {
  assert.equal(sanitizeEventDescriptionHtml('<div><br></div>'), '');
  assert.equal(sanitizeEventDescriptionHtml(null), '');
});

test('plain text derivation keeps lines, lists and links readable', () => {
  const html = 'Intro <b>line</b><div>Second</div><div><br></div><ul><li>One</li><li>Two</li></ul>' +
    '<ol><li>First</li><li>Second</li></ol><div><a href="https://sdgatx.com/events">Tickets</a> &amp; more</div>';
  assert.equal(
    htmlToPlainText(html),
    'Intro line\nSecond\n\n• One\n• Two\n1. First\n2. Second\nTickets (https://sdgatx.com/events) & more'
  );
});

test('legacy plain descriptions round-trip through the editor unchanged', () => {
  const text = 'Doors at 10.\nBring ID.\n\nNo re-entry & 21+.';
  assert.equal(htmlToPlainText(plainTextToEditorHtml(text)), text);
});

test('event pages render sanitized HTML with a plain-text fallback', () => {
  const detail = readFileSync(new URL('../app/events/_components/EventDetail.jsx', import.meta.url), 'utf8');
  assert.match(detail, /sanitizeEventDescriptionHtml\(event\.description_html\)/);
  assert.match(detail, /dangerouslySetInnerHTML=\{\{ __html: descriptionHtml \}\}/);
});

test('recurring occurrences copy the formatted description', () => {
  const series = readFileSync(new URL('../lib/event-series.js', import.meta.url), 'utf8');
  assert.match(series, /'description_html'/);
});
