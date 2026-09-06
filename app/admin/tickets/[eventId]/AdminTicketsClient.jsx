'use client';
import { useEffect, useState } from 'react';
import ProductEditor from './ProductEditor';

function money(cents, currency = 'usd') {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export default function AdminTicketsClient({ eventId }) {
  const [tab, setTab] = useState('summary');
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    setBusy(true);
    try {
      const [s, p, o] = await Promise.all([
        fetch(`/api/admin/tickets/summary?event_id=${eventId}`).then((r) => r.json()),
        fetch(`/api/admin/tickets/products?event_id=${eventId}`).then((r) => r.json()),
        fetch(`/api/admin/tickets/orders?event_id=${eventId}`).then((r) => r.json()),
      ]);
      setSummary(s);
      setProducts(p.products || []);
      setOrders(o.orders || []);
      setErr(null);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally { setBusy(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [eventId]);

  async function refundOrder(orderId) {
    const amountStr = prompt('Refund amount in cents (blank = full remaining):', '');
    if (amountStr === null) return;
    const amount_cents = amountStr === '' ? null : parseInt(amountStr, 10);
    if (amount_cents !== null && (!Number.isFinite(amount_cents) || amount_cents <= 0)) return alert('Bad amount');
    if (!confirm('Confirm refund?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tickets/orders/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refund', amount_cents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (e) { alert(`Refund failed: ${e.message}`); } finally { setBusy(false); }
  }

  async function resendOrder(orderId) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tickets/orders/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend' }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      alert('Resent.');
    } catch (e) { alert(`Resend failed: ${e.message}`); } finally { setBusy(false); }
  }

  async function issueComp() {
    const product_id = products[0]?.id;
    if (!product_id) return alert('Create a product first.');
    const buyer_email = prompt('Comp recipient email:');
    if (!buyer_email) return;
    const qty = parseInt(prompt('Quantity:', '1'), 10);
    if (!qty || qty < 1) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tickets/comp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId, product_id, quantity: qty, buyer_email,
          comp_ref: `manual-${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`Issued ${data.tickets} comp ticket(s).`);
      await load();
    } catch (e) { alert(`Comp failed: ${e.message}`); } finally { setBusy(false); }
  }

  return (
    <div>
      {err && <div style={{ color: '#a00', margin: 12 }}>{err}</div>}
      <nav style={{ display: 'flex', gap: 8, borderBottom: '1px solid #eee', margin: '12px 0' }}>
        {['summary', 'products', 'orders'].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 12px', background: tab === t ? '#111' : 'transparent', color: tab === t ? '#fff' : '#111', border: 0, cursor: 'pointer' }}>
            {t}
          </button>
        ))}
        <button onClick={load} disabled={busy} style={{ marginLeft: 'auto' }}>{busy ? 'Loading…' : 'Refresh'}</button>
        <button onClick={issueComp} disabled={busy}>Issue comp</button>
      </nav>

      {tab === 'summary' && summary && (
        <section>
          <h2>Money</h2>
          <div>Gross: {money(summary.money.gross_cents)}</div>
          <div>Refunded: {money(summary.money.refunded_cents)}</div>
          <div><strong>Net: {money(summary.money.net_cents)}</strong></div>
          <h2 style={{ marginTop: 20 }}>Tickets</h2>
          <pre style={{ background: '#f6f6f6', padding: 10 }}>{JSON.stringify(summary.tickets, null, 2)}</pre>
          <h2>Scans</h2>
          <pre style={{ background: '#f6f6f6', padding: 10 }}>{JSON.stringify(summary.scans, null, 2)}</pre>
          <h2>Inventory</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>Product</th><th>Total</th><th>Sold</th><th>Held</th><th>Remaining</th></tr></thead>
            <tbody>
              {summary.products.map((p) => {
                const rem = typeof p.total_inventory === 'number' ? p.total_inventory - (p.sold_count || 0) - (p.held_count || 0) : '∞';
                return <tr key={p.id}><td>{p.name}</td><td>{p.total_inventory ?? '∞'}</td><td>{p.sold_count}</td><td>{p.held_count}</td><td>{rem}</td></tr>;
              })}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'products' && (
        <section>
          <ProductEditor eventId={eventId} products={products} onReload={load} />
        </section>
      )}

      {tab === 'orders' && (
        <section>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ borderBottom: '1px solid #ccc' }}><th align="left">Buyer</th><th align="left">Status</th><th align="right">Total</th><th align="right">Refunded</th><th align="left">Tickets</th><th align="left">When</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{o.buyer_email}</td>
                  <td>{o.status}</td>
                  <td align="right">{money(o.total_cents, o.currency)}</td>
                  <td align="right">{money(o.refunded_cents || 0, o.currency)}</td>
                  <td>{o.tickets.length}</td>
                  <td>{new Date(o.paid_at || o.created_at).toLocaleString()}</td>
                  <td>
                    <button onClick={() => resendOrder(o.id)} disabled={busy}>Resend</button>{' '}
                    {['paid', 'partial_refund'].includes(o.status) && <button onClick={() => refundOrder(o.id)} disabled={busy}>Refund</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
