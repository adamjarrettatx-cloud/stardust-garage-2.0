import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminPageGate } from '@/lib/auth-helpers';
import { loadEventFinancials } from '@/lib/event-financials-data';
import EventFinancialsClient from './EventFinancialsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function EventFinancialsPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  // Access gated above; this server component reads with the service-role
  // client (never bundled to the browser).
  const admin = createAdminClient();
  const data = await loadEventFinancials(admin, id);
  if (!data) notFound();

  // Contracts linked to this event, so the admin can pick which one's terms
  // drive the split.
  const { data: contracts } = await admin
    .from('document_contracts')
    .select('id, document_id, status, stardust_split_percent, flat_fee_cents, revenue_share_recipient, financial_terms_source')
    .eq('event_id', id)
    .order('updated_at', { ascending: false });

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <Link
        href={`/bananas/events/${id}`}
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK TO EVENT
      </Link>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Event Financials
        </h1>
        <div className="text-[11px] tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>ADMIN ONLY</div>
      </div>
      <p className="mb-8 text-[14px]" style={{ color: 'var(--text-3)' }}>
        {data.event.title}. Combines TicketTailor ticket sales, imported POS CSV totals, and contract
        split terms into a per-event profit view. Ticket revenue is sourced from TicketTailor only.
      </p>

      <EventFinancialsClient eventId={id} initial={data} contracts={contracts || []} />
    </main>
  );
}
