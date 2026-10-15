'use client';

// Organizer-facing settlement. Renders ONLY the organizer-safe snapshot built
// by lib/event-writeup organizerView(); it has no access to Stardust Garage's
// totals. Used in the partner portal and as the admin's "what the organizer
// sees" preview, so both always match.

const BORDER = '#39362f';
const CARD = '#161512';
const MUTED = '#aaa69c';
const TEXT = '#f3f1eb';
const GOLD = '#d9bd79';

function usd(cents) {
  return (Number(cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function minus(cents) {
  return cents ? `-${usd(Math.abs(cents))}` : usd(0);
}
function pct(bps) {
  return `${(Number(bps || 0) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

function Row({ label, value, bold = false, first = false }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0',
      borderTop: first ? 'none' : '1px solid #2a2823',
      fontSize: bold ? 16 : 14, fontWeight: bold ? 700 : 400,
    }}>
      <span style={{ color: bold ? TEXT : MUTED }}>{label}</span>
      <span style={{ color: TEXT, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Box({ title, subtitle, children }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, background: CARD, borderRadius: 12, padding: 20 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', margin: 0, color: TEXT }}>{title}</h3>
      {subtitle ? <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 8px' }}>{subtitle}</p> : <div style={{ height: 8 }} />}
      {children}
    </div>
  );
}

export default function OrganizerWriteup({ view, proofs = [], proofHref, sharedAt }) {
  if (!view) return null;
  const o = view.online;
  const d = view.door;
  return (
    <section aria-label="Event settlement" style={{ color: TEXT }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '30px 0 6px' }}>Your settlement</h2>
      {sharedAt ? (
        <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px' }}>
          Shared by Stardust Garage on {new Date(sharedAt).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })} Central
        </p>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
        <Box title={`Online tickets · ${o.tickets_sold} sold`}>
          <Row first label="Gross revenue" value={usd(o.gross_cents)} />
          {o.refunds_cents ? <Row label="Refunds" value={minus(o.refunds_cents)} /> : null}
          <Row label="Sales tax (8.25%)" value={minus(o.sales_tax_cents)} />
          <Row label="Booking & card processing fees" value={minus(o.fees_cents)} />
          <Row bold label="Net online" value={usd(o.net_cents)} />
        </Box>

        <Box title="Door sales" subtitle={d.entered ? null : 'Door sales have not been entered.'}>
          <Row first label="Gross revenue" value={usd(d.gross_cents)} />
          <Row label={`Sales tax (${pct(d.sales_tax_bps)})`} value={minus(d.sales_tax_cents)} />
          <Row label={`Card fees (${pct(d.cc_fee_bps)})`} value={minus(d.cc_fees_cents)} />
          <Row bold label="Net door" value={usd(d.net_cents)} />
          {proofs.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {proofs.map((p, i) => (
                <a
                  key={p.id}
                  href={proofHref ? proofHref(p.id) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600 }}
                >
                  {proofs.length > 1 ? `View POS proof ${i + 1}` : 'View POS proof'}
                </a>
              ))}
            </div>
          ) : null}
        </Box>
      </div>

      <Box title="Your payout">
        <Row first label="Net ticket revenue (online + door)" value={usd(view.net_ticket_revenue_cents)} />
        <Row label={`Your share (${view.organizer_percent ?? 0}%)`} value={usd(view.gross_payout_cents)} />
        {view.adjustments.map((a, i) => (
          <Row key={i} label={a.label} value={a.amount_cents < 0 ? minus(a.amount_cents) : `+${usd(a.amount_cents)}`} />
        ))}
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 0 2px', marginTop: 4,
          borderTop: `1px solid ${BORDER}`, fontSize: 20, fontWeight: 750,
        }}>
          <span>Net payout to you</span>
          <span style={{ color: GOLD, fontVariantNumeric: 'tabular-nums' }}>{usd(view.net_payout_cents)}</span>
        </div>
      </Box>
    </section>
  );
}
