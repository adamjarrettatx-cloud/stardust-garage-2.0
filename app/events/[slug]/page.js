import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EventDetail from '../_components/EventDetail';

export const revalidate = 0;

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
  // Admins can preview drafts via /events/[slug]/preview (admin-gated).
  if (error || !event || event.status === 'draft' || event.visibility === 'internal') {
    notFound();
  }

  return <EventDetail event={event} />;
}
