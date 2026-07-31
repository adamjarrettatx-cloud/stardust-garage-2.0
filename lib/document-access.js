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

// RFC 5987 Content-Disposition for a streamed document version.
export function contentDisposition(filename, inline = false) {
  const name = String(filename || 'document').replace(/["\\\r\n]/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(filename || 'document')}`;
}
