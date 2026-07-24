'use client';

import Link from 'next/link';

function formatEventDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function EventCard({ event }) {
  return (
    <div className="relative group">
      <Link href={`/events/${event.slug}`} className="block">
        <div className="relative overflow-hidden rounded-[14px] bg-[#1a1a1a] transition-transform group-hover:-translate-y-1" style={{ aspectRatio: '3 / 4' }}>
          {event.image_url && (
            <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
          )}
        </div>
        <div className="text-xs mt-4 mb-2" style={{ color: '#8a8a8a' }}>
          {formatEventDate(event.event_date)}
        </div>
        <h3 className="text-[17px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {event.title}
        </h3>
      </Link>

      {event.ticket_url ? (
        <a
          href={event.ticket_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-[18px] right-[18px] bg-white text-[#0a0a0a] px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] hover:bg-gray-200 transition-colors z-10"
        >
          BUY TICKETS
        </a>
      ) : (
        <span
          className="absolute top-[18px] right-[18px] px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border pointer-events-none"
          style={{
            borderColor: 'rgba(255,255,255,0.3)',
            color: '#f5f5f5',
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(4px)',
          }}
        >
          PRIVATE
        </span>
      )}
    </div>
  );
}
