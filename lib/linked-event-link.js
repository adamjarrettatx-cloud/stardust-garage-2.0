// Where a team event's "linked site event" marker should point, per viewer.
//
// Admins get the dashboard page. Everyone else can only reach the public
// /events/[slug] page: /bananas/* is admin-gated by middleware.js, and the
// public page 404s events that are internal or still drafts. Returns null when
// there is no page the viewer can actually open, so callers render plain text
// instead of a dead link.

import { isInternalEvent } from './event-visibility.js';

export function linkedEventHref(linkedEvent, isAdmin) {
  if (!linkedEvent?.id) return null;
  if (isAdmin) return `/bananas/events/${linkedEvent.id}`;
  if (!linkedEvent.slug || isInternalEvent(linkedEvent) || linkedEvent.status === 'draft') return null;
  return `/events/${linkedEvent.slug}`;
}
