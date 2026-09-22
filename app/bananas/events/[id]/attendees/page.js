import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import EventAttendeesClient from './EventAttendeesClient';

export const dynamic = 'force-dynamic';

export default async function EventAttendeesPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);
  const { id } = await params;
  const db = await createClient();
  const { data: event, error } = await db.from('events')
    .select('id, title, event_date, ticketing_mode').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!event) notFound();
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
      <Link href="/bananas?tab=events" style={{ color: 'var(--auth-muted)', fontSize: 14 }}>
        ← Events
      </Link>
      <EventAttendeesClient event={event} />
    </div>
  );
}
