import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import EventForm from '../../components/EventForm';
import PublishEventButton from '../../components/PublishEventButton';
import ArtistLineupPanel from './ArtistLineupPanel';

export const revalidate = 0;

export default async function EditEventPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !event) {
    notFound();
  }

  // Cached metrics row (if any) so the editor can show when this event's sales
  // figures were last refreshed. Degrades gracefully if the table is absent.
  let metrics = null;
  const metricsRes = await supabase
    .from('event_ticket_metrics')
    .select('status, fetched_at, source')
    .eq('event_id', id)
    .maybeSingle();
  if (!metricsRes.error) metrics = metricsRes.data || null;

  return (
    <EventForm
      event={event}
      metrics={metrics}
      headerActions={(
        <Link
          href={`/bananas/events/${event.id}/financials`}
          className="auth-theme-border-button px-4 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
          style={{ color: 'var(--auth-accent)' }}
        >
          FINANCIALS
        </Link>
      )}
      statusPanel={(
        <PublishEventButton
          eventId={event.id}
          status={event.status}
          ttEventSeriesId={event.tt_event_series_id}
        />
      )}
      footerPanels={(
        <>
          <ArtistLineupPanel eventId={event.id} />
          {/* The guest list used to be a panel at the bottom of this form, which
              meant the Events row's GUEST LIST button and this page showed two
              halves of one job. It's a full screen of its own now - roll-up,
              grant form, hosts and named guests - so this links there rather
              than shipping a second copy that can drift. */}
          <Link
            href={`/bananas/guest-list/${event.id}`}
            className="block rounded-[12px] border p-5 mt-8 transition-colors hover:bg-white/5"
            style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
          >
            <div
              className="text-[12px] font-semibold tracking-[0.14em] mb-1"
              style={{ color: 'var(--auth-muted)' }}
            >
              GUEST LIST ALLOCATION
            </div>
            <div className="text-[13px]" style={{ color: 'var(--auth-text)' }}>
              Grant door spots to partners and see every named guest for this
              event.{' '}
              <span className="font-semibold" style={{ color: 'var(--auth-accent)' }}>
                OPEN GUEST LIST →
              </span>
            </div>
          </Link>
        </>
      )}
    />
  );
}
