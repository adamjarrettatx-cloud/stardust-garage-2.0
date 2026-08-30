// Who may read which document, expressed as pure functions so the rule lives in
// one place instead of being restated by the middleware, the pages and the
// download route.
//
// The document hub was built admin-only: every RLS policy, page gate and API
// route in /bananas/documents checks is_admin(). SOPs live in that same hub
// (category 'sops'), so a team member who opened an SOP link was bounced by the
// middleware to /team/calendar. SOPs are staff reading material, so they are
// carved out here — everything else in the hub (contracts, finance, vendor
// paperwork, templates, the field editor) stays admin-only.

// Categories any team member may READ. Deliberately narrow: adding a category
// here also widens the RLS policy in 20260803_team_visible_sops.sql, so the two
// must be changed together.
export const TEAM_VISIBLE_CATEGORIES = ['sops'];

const UUID = /^[0-9a-f-]{36}$/i;

// Team members only ever see published SOPs. Drafts and archived revisions stay
// admin-only so an in-progress rewrite is not mistaken for current policy.
export function isTeamVisibleDocument(doc) {
  if (!doc) return false;
  return TEAM_VISIBLE_CATEGORIES.includes(doc.category) && doc.status === 'active';
}

// Maps an admin document URL a team member landed on to its team-readable
// equivalent, or null when there is no equivalent. Used by the middleware so
// SOP links shared in chat resolve instead of dead-ending on the calendar.
//
// Only the hub index and individual documents map. /bananas/documents/templates
// and the field editor under it are admin tooling with no team counterpart, and
// the `templates` segment is not a UUID so it falls through to null.
export function teamDocumentPath(pathname) {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (path === '/bananas/documents') return '/team/documents';

  const match = /^\/bananas\/documents\/([^/]+)$/.exec(path);
  if (match && UUID.test(match[1])) return `/team/documents/${match[1].toLowerCase()}`;

  return null;
}

// Fold a filename down to something safe inside the quoted `filename=""` header
// parameter.
//
// WHY THIS EXISTS: HTTP header values are ByteStrings - every code unit must be
// <= 255. Passing a filename containing a character outside Latin-1 (an em dash,
// a curly quote, an accented letter, an emoji - all of which real uploads have)
// straight into the quoted parameter makes `new Response()` throw
// "TypeError: Cannot convert argument to a ByteString ...", which reaches staff
// as a bare HTTP 500 when they click "View" on a document whose name happens to
// contain one. Reproduced against a live document titled with an em dash.
//
// The quoted parameter is only the legacy fallback: the RFC 5987 `filename*`
// parameter carries the real, fully-Unicode name (percent-encoded, so ASCII by
// construction) and every current browser prefers it. So it is safe to
// transliterate common punctuation and drop anything else unrepresentable rather
// than failing the entire response.
export function asciiSafeFilename(filename) {
  const cleaned = String(filename || 'document')
    // Typographic punctuation that shows up in generated titles.
    .replace(/[\u2010-\u2015\u2212]/g, '-')       // hyphens, en/em dash, minus
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'") // curly single quotes, prime
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '')  // curly double quotes
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ') // exotic spaces
    // Characters that would break the quoted parameter itself.
    .replace(/["\\\r\n]/g, '')
    // Anything still outside printable ASCII cannot live in this parameter.
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // A name that was entirely non-ASCII (e.g. all CJK) folds to nothing usable -
  // possibly leaving just an extension like ".pdf". Give it a real stem so the
  // fallback download still has a sensible name; the `filename*` parameter still
  // carries the true one.
  if (!/[A-Za-z0-9]/.test(cleaned.replace(/\.[A-Za-z0-9]{1,8}$/, ''))) {
    const ext = /(\.[A-Za-z0-9]{1,8})$/.exec(cleaned);
    return `document${ext ? ext[1] : ''}`;
  }
  return cleaned;
}

// RFC 5987 Content-Disposition for a streamed document version.
export function contentDisposition(filename, inline = false) {
  const name = asciiSafeFilename(filename);
  return `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(String(filename || 'document'))}`;
}
