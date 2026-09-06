'use client';
import { useEffect, useState } from 'react';

function money(cents, currency = 'usd') {
  if (typeof cents !== 'number') return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export default function WalletClient({ walletEnabled }) {
  const [pms, setPms] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [pmRes, orderRes] = await Promise.all([
        walletEnabled ? fetch('/api/wallet/payment-methods').then((r) => r.json()) : { payment_methods: [] },
        fetch('/api/wallet/orders').then((r) => r.json()),
      ]);
      setPms(pmRes.payment_methods || []);
      setOrders(orderRes.orders || []);
      setErr(null);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function startSetup() {
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Setup failed');
      window.location.href = data.url;
    } catch (e) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  async function pmAction(pm_id, action) {
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method_id: pm_id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      await load();
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function resend(order_id) {
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/resend-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resend failed');
      alert('Tickets re-sent to your email.');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div>Loading…</div>;

  return (
    <div>
      {err && <div style={{ color: '#a00', margin: '12px 0' }}>{err}</div>}

      {walletEnabled && (
        <section style={{ margin: '24px 0' }}>
          <h2>Payment methods</h2>
          {pms.length === 0 && <p style={{ color: '#666' }}>No cards on file.</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {pms.map((pm) => (
              <li key={pm.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee' }}>
                <span>
                  {pm.brand?.toUpperCase() || 'CARD'} •••• {pm.last4} — {String(pm.exp_month).padStart(2, '0')}/{pm.exp_year}
                  {pm.is_default && <strong> · Default</strong>}
                </span>
                <span>
                  {!pm.is_default && (
                    <button disabled={busy} onClick={() => pmAction(pm.stripe_payment_method_id, 'default')}>Make default</button>
                  )}
                  <button disabled={busy} onClick={() => pmAction(pm.stripe_payment_method_id, 'delete')} style={{ marginLeft: 8 }}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
          <button disabled={busy} onClick={startSetup} style={{ padding: '10px 14px', marginTop: 8 }}>Add a card</button>
        </section>
      )}

      <section style={{ margin: '24px 0' }}>
        <h2>Purchase history</h2>
        {orders.length === 0 && <p style={{ color: '#666' }}>No purchases yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {orders.map((o) => (
            <li key={o.id} style={{ padding: '12px 0', borderBottom: '1px solid #eee' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{o.event?.title || 'Event'}</strong>
                <span>{money(o.total_cents, o.currency)}</span>
              </div>
              <div style={{ fontSize: 13, color: '#666' }}>
                {o.event?.event_date} · {o.tickets.length} ticket{o.tickets.length === 1 ? '' : 's'} · {o.status}
              </div>
              <button disabled={busy} onClick={() => resend(o.id)} style={{ marginTop: 6 }}>Resend tickets</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
