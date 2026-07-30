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

  // Draft events and internal micro-party events are not public — treat them as
  // missing so neither a draft slug nor an internal slug can be reached directly.
  if (error || !event || event.status === 'draft' || event.visibility === 'internal') {
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

      <div className="grid gap-6 md:gap-12 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
        {event.image_url && (
          <div className="relative w-full rounded-[14px] overflow-hidden bg-[#111]">
            {/* Blurred copy of the flier tints whatever letterbox/pillarbox gap its aspect ratio leaves. */}
            <img
              src={event.image_url}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-40"
            />
            <img
              src={event.image_url}
              alt={event.title}
              className="relative block mx-auto w-auto h-auto max-w-full max-h-[45vh] md:max-h-[70vh] object-contain"
            />
          </div>
        )}

        {/* Mobile stacks as flex so the ticket CTA can sit directly under the flier, above the
            fold, no matter how long the title runs. Desktop reverts to DOM order. */}
        <section className="flex flex-col md:block">
          <h1 className="order-3 text-[28px] md:text-[32px] font-extrabold -tracking-[0.02em] mb-1.5 leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {event.title}
          </h1>
          <div className="order-4 text-[20px] md:text-[22px] font-bold -tracking-[0.01em] mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {formatEventDate(event.event_date)}
          </div>

          {event.ticket_url ? (
            <a
              href={event.ticket_url}
              target="_blank"
              rel="noopener noreferrer"
              className="order-1 block w-full text-center md:inline-block md:w-auto bg-white text-[#0a0a0a] px-[22px] py-3 md:py-2.5 rounded-full text-[13px] font-bold tracking-[0.08em] mb-8 hover:bg-gray-200 transition-colors"
            >
              BUY TICKETS
            </a>
          ) : (
            <div
              className="order-1 block w-full text-center md:inline-block md:w-auto px-[22px] py-3 md:py-2.5 rounded-full text-[13px] font-bold tracking-[0.08em] mb-8 border"
              style={{ borderColor: 'rgba(255,255,255,0.3)', color: '#8a8a8a' }}
            >
              PRIVATE EVENT
            </div>
          )}

          {discountCallout.show && (
            <div
              className="order-2 flex items-center gap-2.5 px-4 py-3 rounded-[10px] mb-8 -mt-3"
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
            <div className="order-5 py-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <div className="text-[13px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Time</div>
              <div className="text-sm leading-[1.6]" style={{ color: '#8a8a8a' }}>
                {event.event_end_time ? `${event.event_time} – ${event.event_end_time}` : event.event_time}
              </div>
            </div>
          )}

          <div className="order-6 py-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-[13px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Venue</div>
            <div className="text-sm leading-[1.6]" style={{ color: '#8a8a8a' }}>
              Stardust Garage<br />
              St. Elmo Arts District<br />
              Austin, TX 78745
            </div>
          </div>

          <div className="order-7 py-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-[13px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>About</div>
            {event.description ? (
              <div className="text-[15px] leading-[1.7]" style={{ whiteSpace: 'pre-wrap' }}>
                {event.description}
              </div>
            ) : (
              <p className="text-[15px] leading-[1.7]" style={{ color: '#8a8a8a' }}>
                More details coming soon.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
