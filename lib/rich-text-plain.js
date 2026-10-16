// Dependency-free helpers shared by the browser editor and the server.
// Kept apart from lib/rich-text.js so the client bundle never pulls in
// sanitize-html.

// Marks a line break implied by a block tag, so nested blocks don't stack up.
const SOFT = '\u0001';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Converts editor HTML to the plain-text description every non-website surface
// reads (mobile app, team schedule, TicketTailor, calendar previews). Lists
// become "• item" / "1. item" lines and links become "text (url)".
export function htmlToPlainText(html) {
  if (typeof html !== 'string' || !html) return '';
  let s = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r?\n/g, ' ');

  // Number ordered-list items before the generic list handling.
  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let n = 0;
    return inner.replace(/<li\b[^>]*>/gi, () => `${SOFT}${++n}. `);
  });
  s = s.replace(/<li\b[^>]*>/gi, `${SOFT}• `);

  s = s.replace(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_, __, href, inner) => {
    const label = inner.replace(/<[^>]*>/g, '').trim();
    const url = decodeEntities(href).replace(/^mailto:/i, '');
    if (!label) return url;
    return decodeEntities(label) === url ? label : `${label} (${url})`;
  });

  s = s
    // An empty line in the editor is a block containing only <br>.
    .replace(/<(div|p)\b[^>]*>\s*<br\s*\/?>\s*<\/\1>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(div|p|ul|ol|h[1-6]|blockquote)\b[^>]*>/gi, SOFT)
    .replace(/<[^>]*>/g, '');

  // Nested block starts (<div><ul><li>) collapse to a single line break.
  return decodeEntities(s.replace(/\u0001+/g, '\n'))
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Seeds the editor from a legacy plain-text description, one block per line
// (matching what the browser creates when you press Enter), so a description
// round-trips through htmlToPlainText unchanged.
export function plainTextToEditorHtml(text) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!value) return '';
  return value
    .split('\n')
    .map((line) => (line.trim() ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>'))
    .join('');
}
