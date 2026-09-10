import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EventDetail from '../_components/EventDetail';
import { isUnlistedEvent } from '@/lib/event-visibility';
import { isEventStillListable } from '@/lib/events/is-event-listable';

export const revalidate = 0;

async function getPublicOrSharedEvent(supabase, slug, token, select) {
  // RLS permits direct event-table reads only for published public events.
  // A valid capability token is the sole way an anonymous visitor can get an
  // unlisted row; also require the slug to match so a token cannot render a
  // different event at an arbitrary route.
  if (typeof token === 'string' && token) {
    const { data: shared } = await supabase
      .rpc('get_event_by_share_token', { token })
      .maybeSingle();
    if (shared?.slug === slug) return shared;
  }

  const { data } = await supabase
    .from('events')
    .select(select)
    .eq('slug', slug)
    .eq('status', 'published')
    .eq('visibility', 'public')
    .maybeSingle();
  return data || null;
}

// Per-event <head>: unlisted events must not be indexed by search engines.
// Public events keep the site's default indexable behavior.
export async function generateMetadata({ params, searchParams }) {
  const { slug } = await params;
  const token = (await searchParams)?.t;
  const supabase = await createClient();
  const event = await getPublicOrSharedEvent(supabase, slug, token, 'title, visibility, status, slug');

  if (!event) return {};
  const base = { title: event.title };
  if (isUnlistedEvent(event)) return { ...base, robots: { index: false, follow: false } };
  return base;
}

export default async function EventPage({ params, searchParams }) {
  const { slug } = await params;
  const token = (await searchParams)?.t;
  const supabase = await createClient();
  const event = await getPublicOrSharedEvent(supabase, slug, token, '*');

  if (!event) notFound();
  if (!isEventStillListable(event)) notFound();
  const unlisted = isUnlistedEvent(event);

  return (
    <>
      {unlisted && (
        <div
          className="w-full border-b"
          style={{ background: '#0a0a0a', borderColor: 'rgba(255,255,255,0.12)' }}
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
              Private link — not on the public events page. Share only with people you want at this event.
            </span>
            <Link
              href="/events"
              className="ml-auto text-[11px] font-semibold tracking-[0.14em]"
              style={{ color: '#8a8a8a' }}
            >
              PUBLIC EVENTS →
            </Link>
          </div>
        </div>
      )}

      <EventDetail event={event} />
    </>
  );
}
