import { createClient } from '@supabase/supabase-js';
import { renderTicketQrSvg } from '@/lib/tickets/qr';
import { normalizeTicketCode } from '@/lib/tickets/codes';

// /t/[code] — Public ticket detail page. Anyone with the code sees the QR
// (the code IS the auth), so once used the page shows "already used".
// Deep-linked from the confirmation email and re-openable from the wallet.
export const dynamic = 'force-dynamic';

export default async function TicketDetailPage({ params }) {
  const { code: rawCode } = await params;
  const code = normalizeTicketCode(rawCode);
  if (!code) {
    return (
      <main style={{ maxWidth: 480, margin: '48px auto', padding: 20 }}>
        <h1>Invalid ticket link</h1>
      </main>
    );
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, ticket_code, status, event_id, order_id, order_item_id')
    .eq('ticket_code', code)
    .maybeSingle();

  if (!ticket) {
    return (
      <main style={{ maxWidth: 480, margin: '48px auto', padding: 20 }}>
        <h1>Ticket not found</h1>
      </main>
    );
  }

  const [event, item] = await Promise.all([
    supabaseAdmin.from('events').select('id, title, event_date, start_time').eq('id', ticket.event_id).maybeSingle(),
    supabaseAdmin.from('order_items').select('product_name_snapshot, tier_name_snapshot').eq('id', ticket.order_item_id).maybeSingle(),
  ]);

  const banner =
    ticket.status === 'used' ? { color: '#666', text: 'This ticket has been used' } :
    ticket.status === 'refunded' ? { color: '#a00', text: 'This ticket was refunded' } :
    ticket.status === 'void' ? { color: '#a00', text: 'This ticket is void' } :
    null;

  const qr = ticket.status === 'valid' ? renderTicketQrSvg({ ticketCode: ticket.ticket_code, size: 260 }) : null;

  return (
    <main style={{ maxWidth: 480, margin: '32px auto', padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Stardust Garage</div>
      <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>{event.data?.title || 'Event'}</h1>
      {event.data?.event_date && (
        <div style={{ color: '#666', marginBottom: 16 }}>
          {event.data.event_date}{event.data.start_time ? ` · ${event.data.start_time}` : ''}
        </div>
      )}

      {qr && (
        <div style={{ margin: '20px auto', width: 260 }} dangerouslySetInnerHTML={{ __html: qr }} />
      )}

      {banner && (
        <div style={{ padding: 12, background: '#f4f4f4', color: banner.color, borderRadius: 6, margin: '12px 0' }}>
          {banner.text}
        </div>
      )}

      <div style={{ fontFamily: 'monospace', fontSize: 14, marginTop: 12 }}>{ticket.ticket_code}</div>
      {item.data && (
        <div style={{ color: '#666', marginTop: 6 }}>
          {item.data.product_name_snapshot}
          {item.data.tier_name_snapshot ? ` — ${item.data.tier_name_snapshot}` : ''}
        </div>
      )}
    </main>
  );
}
