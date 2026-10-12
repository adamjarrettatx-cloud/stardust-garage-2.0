'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Icon-only delete control for the Events list row. Rendered as the right
// half of the row's Edit/Delete segmented control (see EventsSection.js), so
// it carries no border of its own — the group owns the outline. Destructive
// intent is signalled by the danger tint on hover/focus rather than a
// permanent red outline, which keeps the row calm while still making the
// action unmistakable at the moment of use.
export default function DeleteEventButton({ eventId, eventTitle, className = '' }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    const confirmed = window.confirm(`Delete "${eventTitle}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase.from('events').delete().eq('id', eventId);

    if (error) {
      alert('Error deleting event: ' + error.message);
      setDeleting(false);
    } else {
      router.refresh();
    }
  };

  const label = deleting ? `Deleting ${eventTitle}` : `Delete ${eventTitle}`;

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      aria-label={label}
      title={deleting ? 'Deleting…' : 'Delete event'}
      className={`sdg-row-icon-btn sdg-row-icon-btn--danger ${className}`}
    >
      {deleting ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
          <path d="M18.5 6l-.8 13.1A2 2 0 0 1 15.7 21H8.3a2 2 0 0 1-2-1.9L5.5 6" />
          <path d="M10 10.5v6" />
          <path d="M14 10.5v6" />
        </svg>
      )}
    </button>
  );
}
