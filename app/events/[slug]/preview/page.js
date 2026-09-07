import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import EventDetail from '../../_components/EventDetail';

export const revalidate = 0;

// Admin-only preview of an event's public page. Renders the exact same UI as
// the live /events/[slug] route, but ignores status='draft' and
// visibility='internal' so a work-in-progress event can be reviewed before
// GO LIVE. Everyone else is redirected to /login (via adminPageGate) — a
// non-admin who guesses the URL never sees draft content.
//
// Purely a viewer: no publish action lives here. The GO LIVE button stays on
// the Edit Event page (/bananas/events/[id]) which is where all authoring
// happens.
export default async function EventPreviewPage({ params }) {
  const { slug } = await params;

  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !event) notFound();

  const isDraft = event.status === 'draft';
  const isInternal = event.visibility === 'internal';

  return (
    <>
      {/* Slim floating banner so the preview is unmistakably not the live page.
          Sticky at the top so it stays visible while you scroll the event body.
          Kept dark + high-contrast on purpose — matches the admin shell tone. */}
      <div
        className="sticky top-0 z-50 w-full border-b"
        style={{
          background: '#0a0a0a',
          borderColor: 'rgba(255,255,255,0.12)',
        }}
      >
        <div className="max-w-[1100px] mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="text-[10px] font-extrabold tracking-[0.14em] px-2 py-1 rounded-full flex-shrink-0"
              style={{ background: '#ffb84d', color: '#0a0a0a' }}
            >
              PREVIEW
            </span>
            <span
              className="text-[11px] font-semibold tracking-[0.06em]"
              style={{ color: '#8a8a8a' }}
            >
              {isDraft
                ? 'Draft — only admins can see this.'
                : isInternal
                  ? 'Internal event — only admins can see this.'
                  : 'Live event — this is how it looks to visitors.'}
            </span>
          </div>
          <Link
            href={`/bananas/events/${event.id}`}
            className="text-[11px] font-semibold tracking-[0.14em] px-3 py-1.5 rounded-full transition-colors flex-shrink-0"
            style={{
              color: '#f5f5f5',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            ← BACK TO EDITOR
          </Link>
        </div>
      </div>

      <EventDetail event={event} />
    </>
  );
}
