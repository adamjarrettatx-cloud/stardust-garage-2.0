import sanitizeHtml from 'sanitize-html';

// Event descriptions can carry light formatting (bold, italic, underline,
// strikethrough, lists, links) written in the admin Description editor.
//
// Storage model:
//   events.description       plain text — read by the iOS/Android app, the
//                            team schedule, TicketTailor and calendar previews.
//   events.description_html  formatted copy — only the website's event page
//                            renders it, and ALWAYS through this sanitizer.
//
// The browser editor writes straight to Supabase, so description_html is never
// trusted: every render re-sanitizes against this strict allow-list.

const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    b: 'strong',
    i: 'em',
    strike: 's',
    del: 's',
    div: 'p',
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: {
        ...(attribs.href ? { href: attribs.href } : {}),
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    }),
  },
  exclusiveFilter: (frame) => frame.tag === 'a' && !frame.attribs.href,
};

export function sanitizeEventDescriptionHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  const clean = sanitizeHtml(html, SANITIZE_OPTIONS).trim();
  // An editor emptied by the user often leaves "<p><br></p>" behind.
  const textOnly = clean.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return textOnly ? clean : '';
}
