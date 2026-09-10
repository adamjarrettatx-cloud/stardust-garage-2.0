import {
  computeEventListingCutoff,
  isEventStillListable,
} from './events/is-event-listable.js';

// Publication shares the exact listing cutoff so the public site never exposes
// two occurrences of a series at the same time.
export function shouldPublishDraft(draft, previousSibling, now = new Date()) {
  if (!draft?.id || !previousSibling?.event_date) return false;

  const cutoff = computeEventListingCutoff(previousSibling);
  if (cutoff) return now >= cutoff;

  // This intentionally uses the listing helper's Chicago end-of-day fallback.
  return !isEventStillListable(previousSibling, now);
}
