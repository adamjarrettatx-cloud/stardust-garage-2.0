'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

// Mirrors SyncTicketTailorButton, but QuickBooks needs a connect step first:
// unlike TicketTailor (an API key set once in Vercel), QuickBooks is a
// per-owner OAuth grant. On mount this checks /quickbooks/status and renders
// either "Connect QuickBooks" (navigates away to Intuit's consent screen) or
// "Sync QuickBooks" (POSTs to sync-quickbooks, same as the TicketTailor
// button does).
export default function SyncQuickBooksButton({ t }) {
  const router = useRouter();
  const [status, setStatus] = useState(null); // { configured, connected, lastSyncedAt }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    adminFetch('/api/admin/financial-ledger/quickbooks/status')
      .then(setStatus)
      .catch((err) => setMsg(err?.message || 'Could not load QuickBooks status'));
  }, []);

  // A previous /connect -> Intuit -> /callback round trip lands back here
  // with a query param; surface it once, then clean the URL so a refresh
  // doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('qbo_connected');
    const error = params.get('qbo_error');
    if (connected) setMsg('QuickBooks connected');
    if (error) setMsg(`QuickBooks: ${error.replace(/_/g, ' ')}`);
    if (connected || error) {
      params.delete('qbo_connected');
      params.delete('qbo_error');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState({}, '', next);
      if (connected) {
        adminFetch('/api/admin/financial-ledger/quickbooks/status').then(setStatus).catch(() => {});
      }
    }
  }, []);

  async function onSync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/financial-ledger/sync-quickbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const parts = [`${res.synced} synced`];
      const skippedTotal = Object.values(res.skipped || {}).reduce(
        (sum, group) => sum + Object.values(group || {}).reduce((s, n) => s + n, 0),
        0
      );
      if (skippedTotal) parts.push(`${skippedTotal} skipped`);
      setMsg(parts.join(' · '));
      router.refresh();
    } catch (err) {
      setMsg(err?.message || 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <button
        type="button"
        disabled
        className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 opacity-50"
        style={{ background: t.btnBg, color: t.btnText }}
      >
        QuickBooks…
      </button>
    );
  }

  if (!status.configured) {
    // Intuit Developer app not registered yet — nothing for the owner to
    // click until QUICKBOOKS_CLIENT_ID/SECRET/REDIRECT_URI are set in Vercel.
    return (
      <span className="text-[12px]" style={{ color: t.muted }}>
        QuickBooks sync not configured
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {status.connected ? (
        <>
          <button
            type="button"
            onClick={onSync}
            disabled={busy}
            data-testid="cf-sync-qbo"
            className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 transition-colors disabled:opacity-50"
            style={{ background: t.btnBg, color: t.btnText }}
          >
            {busy ? 'Syncing…' : 'Sync QuickBooks'}
          </button>
          <a
            href="/api/admin/financial-ledger/quickbooks/connect"
            data-testid="cf-reconnect-qbo"
            className="text-[11px] underline"
            style={{ color: t.muted }}
          >
            Reconnect
          </a>
        </>
      ) : (
        <a
          href="/api/admin/financial-ledger/quickbooks/connect"
          data-testid="cf-connect-qbo"
          className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 border inline-block"
          style={{ borderColor: t.ghostBorder, color: t.ghostText }}
        >
          Connect QuickBooks
        </a>
      )}
      {msg && <span className="text-[12px]" style={{ color: t.muted }}>{msg}</span>}
    </div>
  );
}
