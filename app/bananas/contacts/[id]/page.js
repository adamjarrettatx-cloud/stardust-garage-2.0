import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/auth-helpers';
import ContactDetailClient from './ContactDetailClient';

export const revalidate = 0;

// Team-gated detail/edit page. Everything linked to the contact via contact_id
// is fetched here and rendered as a read-only timeline — that timeline IS the
// revenue/deal history view (there is no separate financial-terms table).
export default async function ContactDetailPage({ params }) {
  const { unauthorized, isAdmin } = await requireTeam();
  if (unauthorized) redirect('/login');

  const { id } = await params;
  const supabase = await createClient();

  const { data: contact, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !contact) notFound();

  const [events, contracts, venueInquiries, collaborations, microParties, audit] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, event_date, slug, status')
      .eq('contact_id', id)
      .order('event_date', { ascending: false }),
    supabase
      .from('document_contracts')
      .select('id, document_id, counterparty_name, status, event_id, flat_fee_cents, created_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('venue_inquiries')
      .select('id, full_name, event_type, preferred_dates, status, created_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('collaborations')
      .select('id, full_name, collaborator_type, status, created_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('micro_party_inquiries')
      .select('id, full_name, event_name, event_date, status, created_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('contact_audit_log')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <ContactDetailClient
        contact={contact}
        isAdmin={isAdmin}
        events={events.data || []}
        contracts={contracts.data || []}
        venueInquiries={venueInquiries.data || []}
        collaborations={collaborations.data || []}
        microParties={microParties.data || []}
        audit={audit.data || []}
      />
    </main>
  );
}
