import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/auth-helpers';
import ContactDetailClient from './ContactDetailClient';
import { isContractorContact } from '@/lib/contact-helpers';

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

  // Only admins can read partner_profiles (RLS), and only admins may invite, so
  // the partner section is skipped entirely for team-role staff.
  const partnerProfile = isAdmin
    ? (
        await supabase
          .from('partner_profiles')
          .select('id, is_active, invited_at, activated_at')
          .eq('contact_id', id)
          .maybeSingle()
      ).data
    : null;

  // Same admin gate as partner_profiles above, and only fetched at all for
  // contractor-type contacts (DJ/artist/performer) since that's the only place
  // the tax profile section renders.
  const taxProfile = isAdmin && isContractorContact(contact.contact_type)
    ? (
        await supabase
          .from('contact_tax_profiles')
          .select('id, contact_id, entity_type, w9_on_file, w9_document_id, w9_received_at, notes, updated_at')
          .eq('contact_id', id)
          .maybeSingle()
      ).data
    : null;

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
    <div className="max-w-[900px]">
      <ContactDetailClient
        contact={contact}
        isAdmin={isAdmin}
        partnerProfile={partnerProfile}
        taxProfile={taxProfile}
        events={events.data || []}
        contracts={contracts.data || []}
        venueInquiries={venueInquiries.data || []}
        collaborations={collaborations.data || []}
        microParties={microParties.data || []}
        audit={audit.data || []}
      />
    </div>
  );
}
