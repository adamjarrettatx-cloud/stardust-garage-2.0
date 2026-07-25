import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminPageGate } from '@/lib/auth-helpers';
import { loadEventFinancials } from '@/lib/event-financials-data';
import EventFinancialsClient from './EventFinancialsClient';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[900px]"
      className="transition-colors duration-150"
      testId="route-bananas-events-id-financials"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref={`/bananas/events/${id}`}
        title="Event Financials"
        subtitle={`${data.event.title}. Combines TicketTailor ticket sales, imported POS CSV totals, and contract split terms into a per-event profit view. Ticket revenue is sourced from TicketTailor only.`}
        right={(
          <div className="text-[11px] tracking-[0.18em]" style={{ color: 'var(--auth-muted)' }}>
            ADMIN ONLY
          </div>
        )}
      />
      <EventFinancialsClient eventId={id} initial={data} contracts={contracts || []} />
    </AuthenticatedPageSurface>
  );
}
