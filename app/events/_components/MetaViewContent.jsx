'use client';

import { useEffect } from 'react';
import { trackMetaEvent } from '@/lib/meta/pixel-client';

// Tells Meta someone viewed a public event page, so ads can reach people
// who looked at an event but have not bought yet. Unlisted events are never
// reported (the parent does not render this for them).
export default function MetaViewContent({ eventId, title }) {
  useEffect(() => {
    if (!eventId) return;
    trackMetaEvent('ViewContent', {
      content_ids: [String(eventId)],
      content_name: title || undefined,
      content_type: 'product',
      content_category: 'event',
    });
  }, [eventId, title]);
  return null;
}
