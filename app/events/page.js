import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 0;

function formatEventDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function EventsPage() {
  const supabase = await createClient();

  // Only published, public-visibility events are public. Draft events (created
  // via the admin "create with TicketTailor" flow before publishing) and
  // internal micro-party events (visibility = 'internal') are hidden here.
  const { data: events } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .order('event_date', { ascending: true });

  const eventList = events || [];

  // Compute "today" in Austin/Central Time, not UTC.
  const todayInAustin = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const today = new Date(todayInAustin + 'T00:00:00');

  const upcoming = eventList.filter((e) => new Date(e.event_date + 'T00:00:00') >= today);

  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-6 py-12 md:py-16">
      <div className="mb-12 max-w-[640px]">
        <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>UPCOMING</div>
        <h1 className="text-[28px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Events</h1>
        <p className="text-[15px] leading-[1.65]" style={{ color: 'rgba(255,255,255,0.6)' }}>All upcoming parties, showcases, and experiences at Stardust Garage.</p>
      </div>

      {upcoming.length === 0 ? (
        <div className="rounded-[18px] p-12 md:p-16 text-center border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <p style={{ color: '#8a8a8a' }}>No upcoming events right now. Check back soon.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {upcoming.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </main>
  );
}

function EventCard({ event }) {
  const date = new Date(event.event_date + 'T00:00:00');
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  const day = date.getDate();
  const weekdayShort = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

  return (
    <div className="group relative rounded-[16px] overflow-hidden border flex flex-col transition-all hover:-translate-y-1 hover:border-white/15" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
      <Link href={`/events/${event.slug}`} className="block relative bg-[#1a1a1a] overflow-hidden" style={{ aspectRatio: '4 / 5' }}>
        {event.image_url ? (
          <img src={event.image_url} alt={event.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'radial-gradient(120% 80% at 50% 0%, rgba(70,55,90,0.45) 0%, rgba(20,18,28,0.95) 55%, rgba(8,8,12,1) 100%)' }}>
            <div className="text-center">
              <div className="text-[10px] font-semibold tracking-[0.2em] mb-1" style={{ color: 'rgba(255,255,255,0.55)' }}>{month}</div>
              <div className="text-[68px] leading-none" style={{ fontFamily: "'Moshra Aesthetic', 'Cormorant Unicase', serif", color: '#ffffff', letterSpacing: '-0.04em' }}>{day}</div>
            </div>
          </div>
        )}
      </Link>

      <div className="p-5 md:p-6 flex flex-col flex-1">
        <div className="flex items-baseline gap-2 mb-3 text-[10px] font-semibold tracking-[0.2em]" style={{ color: 'rgba(255,255,255,0.55)' }}>
          <span>{month}</span>
          <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: '15px', color: '#f5f5f5', letterSpacing: 0 }}>{day}</span>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {weekdayShort}</span>
        </div>

        <Link href={`/events/${event.slug}`}>
          <h3 className="text-[18px] md:text-[20px] font-bold -tracking-[0.01em] mb-2.5 leading-[1.2] hover:opacity-80 transition-opacity" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{event.title}</h3>
        </Link>

        {event.event_time ? (
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-5 flex-1" style={{ color: 'rgba(255,255,255,0.45)' }}>{event.event_time}</div>
        ) : (
          <div className="flex-1 mb-5" />
        )}

        <div className="flex items-center gap-2 mt-auto">
          {event.ticket_url ? (
            <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" className="flex-1 text-center px-4 py-2.5 rounded-full text-[10px] font-semibold tracking-[0.16em] transition-all hover:bg-gray-200" style={{ background: '#ffffff', color: '#0a0a0a' }}>BUY TICKETS</a>
          ) : (
            <span className="flex-1 text-center px-4 py-2.5 rounded-full text-[10px] font-semibold tracking-[0.16em] border" style={{ borderColor: 'rgba(255,255,255,0.2)', color: '#a0a0a0' }}>PRIVATE</span>
          )}
          <Link href={`/events/${event.slug}`} className="px-4 py-2.5 rounded-full text-[10px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5" style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}>DETAILS</Link>
        </div>
      </div>
    </div>
  );
}
