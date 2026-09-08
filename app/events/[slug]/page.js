import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EventDetail from '../_components/EventDetail';
import { isReachableByLink, isUnlistedEvent } from '@/lib/event-visibility';

export const revalidate = 0;

// Per-event <head>: unlisted events must not be indexed by search engines.
// Public events keep the site's default indexable behavior.
export async function generateMetadata({ params }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from('events')
    .select('title, visibility, status')
    .eq('slug', slug)
    .single();

  if (!event) return {};

  const base = { title: event.title };
  // Draft or unlisted events should never be indexed even if the slug leaks.
  // Internal events 404 below so this branch never runs for them.
  if (event.status === 'draft' || isUnlistedEvent(event)) {
    return { ...base, robots: { index: false, follow: false } };
  }
  return base;
}

export default async function EventPage({ params }) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug)
    .single();

  // Draft events and internal (micro-party / team-only) events are never
  // reachable by URL. Unlisted events ARE reachable by URL \u2014 that's the whole
  // point of the tier \u2014 they're just kept off every listing surface. Admins
  // can still preview drafts via /events/[slug]/preview (admin-gated).
  if (error || !event || event.status === 'draft' || !isReachableByLink(event)) {
    notFound();
  }

  const unlisted = isUnlistedEvent(event);

  return (
    <>
      {/* Slim, low-noise banner so anyone opening an unlisted link knows the
          event is not on the public schedule. Only rendered for unlisted
          events \u2014 public events look exactly as they did before. */}
      {unlisted && (
        <div
          className="w-full border-b"
          style={{
            background: '#0a0a0a',
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <div className="max-w-[1100px] mx-auto px-4 md:px-6 py-2.5 flex items-center gap-2.5 flex-wrap">
            <span
              className="text-[10px] font-extrabold tracking-[0.14em] px-2 py-1 rounded-full"
              style={{ background: '#ffb84d', color: '#0a0a0a' }}
            >
              UNLISTED
            </span>
            <span
              className="text-[11px] font-semibold tracking-[0.06em]"
              style={{ color: '#8a8a8a' }}
            >
              Private link \u2014 not on the public events page. Share only with people you want at this event.
            </span>
            <Link
              href="/events"
              className="ml-auto text-[11px] font-semibold tracking-[0.14em]"
              style={{ color: '#8a8a8a' }}
            >
              PUBLIC EVENTS \u2192
            </Link>
          </div>
        </div>
      )}

      <EventDetail event={event} />
    </>
  );
}
