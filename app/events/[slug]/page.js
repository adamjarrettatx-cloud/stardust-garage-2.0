import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { memberDiscountCallout } from '@/lib/event-discount-display';

export const revalidate = 0;

function formatEventDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function EventPage({ params }) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug)
    .single();

  // Draft events are not public — treat them as missing so a draft slug can't
  // be reached directly before it's published.
  if (error || !event || event.status === 'draft') {
    notFound();
  }

  const discountCallout = memberDiscountCallout(event.member_discount_percent);

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-6 py-8 md:py-10">
      <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold tracking-[0.14em] uppercase mb-6 md:mb-7" style={{ color: '#8a8a8a' }}>
        <Link href="/" className="hover:text-white">HOME</Link>
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span>
        <Link href="/events" className="hover:text-white">EVENTS</Link>
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span>
        <span style={{ color: '#f5f5f5' }}>{event.title.toUpperCase()}</span>
      </div>

      <div className="w-full rounded-[14px] overflow-hidden mb-10 md:mb-12 bg-[#111] aspect-[16/10] md:aspect-[16/7]">
        {event.image_url && (
          <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />
        )}
      </div>

      <div className="grid gap-10 md:gap-16 md:grid-cols-[300px_1fr]">
        <aside>
          <h2 className="text-[28px] md:text-[32px] font-extrabold -tracking-[0.02em] mb-1.5 leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {event.title}
          </h2>
          <div className="text-[20px] md:text-[22px] font-bold -tracking-[0.01em] mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {formatEventDate(event.event_date)}
          </div>

          {event.ticket_url ? (
            <a
              href={event.ticket_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-white text-[#0a0a0a] px-[22px] py-2.5 rounded-full text-[13px] font-bold tracking-[0.08em] mb-8 hover:bg-gray-200 transition-colors"
            >
              BUY TICKETS
            </a>
          ) : (
            <div
              className="inline-block px-[22px] py-2.5 rounded-full text-[13px] font-bold tracking-[0.08em] mb-8 border"
              style={{ borderColor: 'rgba(255,255,255,0.3)', color: '#8a8a8a' }}
            >
              PRIVATE EVENT
            </div>
          )}

          {discountCallout.show && (
            <div
              className="flex items-center gap-2.5 px-4 py-3 rounded-[10px] mb-8 -mt-3"
              style={{
                background: 'rgba(255,184,77,0.1)',
                border: '1px solid rgba(255,184,77,0.35)',
              }}
            >
              <span
                className="text-[11px] font-extrabold tracking-[0.1em] px-2 py-1 rounded-full"
                style={{ background: '#ffb84d', color: '#0a0a0a' }}
              >
                MEMBERS
              </span>
              <span className="text-[13px] font-bold tracking-[0.02em]" style={{ color: '#ffb84d' }}>
                Get {discountCallout.percent}% OFF
              </span>
            </div>
          )}

          {event.event_time && (
            <div className="py-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <div className="text-[13px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Time</div>
              <div className="text-sm leading-[1.6]" style={{ color: '#8a8a8a' }}>
                {event.event_time}
              </div>
            </div>
          )}

          <div className="py-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-[13px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Venue</div>
            <div className="text-sm leading-[1.6]" style={{ color: '#8a8a8a' }}>
              Stardust Garage<br />
              St. Elmo Arts District<br />
              Austin, TX 78745
            </div>
          </div>
        </aside>

        <section>
          <h1 className="text-[32px] md:text-[40px] font-extrabold -tracking-[0.02em] mb-6 md:mb-7 leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {event.title}
          </h1>

          {event.description ? (
            <div className="text-[15px] leading-[1.7]" style={{ whiteSpace: 'pre-wrap' }}>
              {event.description}
            </div>
          ) : (
            <p className="text-[15px] leading-[1.7]" style={{ color: '#8a8a8a' }}>
              More details coming soon.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
