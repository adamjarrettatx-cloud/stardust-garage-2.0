'use client';

import { useCallback, useEffect, useState } from 'react';

// Admin-only door-device provisioning UI. Lets Adam mint a revocable setup link
// for each Jelly2 (Front Door / Exit Door), copy it once, open it on the phone,
// and revoke it later. Talks to /api/capacity/devices (admin-gated). The raw
// token / setup URL is returned exactly ONCE on create and shown here until the
// admin dismisses it — it cannot be retrieved again.

const ROLE_LABEL = { front_door: 'Front Door', exit_door: 'Exit Door' };

export default function DeviceManager() {
  const [devices, setDevices] = useState([]);
  const [role, setRole] = useState('front_door');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [justCreated, setJustCreated] = useState(null); // { setup_url, device }
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/capacity/devices', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setDevices(json.devices || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createDevice() {
    setBusy(true); setError(''); setMsg(''); setJustCreated(null); setCopied(false);
    try {
      const res = await fetch('/api/capacity/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_role: role, label: label.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Failed to create device link.');
      } else {
        setJustCreated({ setup_url: json.setup_url, device: json.device, token: json.token });
        setMsg(`${ROLE_LABEL[role]} link created. Copy it now — it won’t be shown again.`);
        setLabel('');
        load();
      }
    } catch {
      setError('Network error creating device link.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(id) {
    if (!confirm('Revoke this device link? The phone using it will stop working until you create a new link.')) return;
    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/capacity/devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'revoke' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error || 'Failed to revoke.');
      else { setMsg('Device link revoked.'); load(); }
    } catch {
      setError('Network error revoking device.');
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — admin can select manually */ }
  }

  const active = devices.filter((d) => d.active && !d.revoked_at);
  const revoked = devices.filter((d) => !d.active || d.revoked_at);

  return (
    <div className="rounded-2xl p-6 mb-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.07)' }}>
      <h2 className="text-[14px] font-bold tracking-[0.12em] uppercase mb-1" style={{ color: '#cfcfcf' }}>Door devices (Jelly2)</h2>
      <p className="text-[12px] mb-4" style={{ color: '#8a8a8a' }}>
        Provision each phone once. Create a link, open it on that phone, and it stays signed in as that door — no team
        account or 2FA needed. Revoke any time to cut a device off instantly.
      </p>

      {/* Setup steps */}
      <ol className="text-[12px] mb-5 pl-4 list-decimal space-y-1" style={{ color: '#9a9a9a' }}>
        <li>Pick <strong>Front Door</strong>, give it a label, and create the link.</li>
        <li>Copy the link and open it in Chrome on the <strong>front</strong> phone. Leave that tab open / add to home screen.</li>
        <li>Pick <strong>Exit Door</strong>, create its link, and open it on the <strong>exit</strong> phone.</li>
      </ol>

      {(msg || error) && (
        <div className="mb-4 text-[13px]" style={{ color: error ? '#ff8a8a' : '#7CFC9B' }}>{error || msg}</div>
      )}

      {/* One-time setup URL */}
      {justCreated?.setup_url && (
        <div className="mb-5 rounded-xl p-4 border" style={{ background: '#0e0e0e', borderColor: 'rgba(124,252,155,0.3)' }}>
          <div className="text-[12px] font-bold mb-2" style={{ color: '#7CFC9B' }}>
            {ROLE_LABEL[justCreated.device?.device_role]} setup link — copy now, shown once
          </div>
          <div
            className="text-[12px] break-all mb-3 p-2 rounded"
            style={{ background: '#000', color: '#cfcfcf', fontFamily: 'monospace' }}
          >
            {justCreated.setup_url}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => copyUrl(justCreated.setup_url)}
              className="px-4 py-2 rounded-lg font-bold text-[13px]"
              style={{ background: '#16a34a', color: '#fff' }}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              type="button"
              onClick={() => setJustCreated(null)}
              className="px-4 py-2 rounded-lg font-bold text-[13px]"
              style={{ background: '#333', color: '#cfcfcf' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-end mb-5">
        <label className="block">
          <span className="block text-[12px] mb-1.5" style={{ color: '#8a8a8a' }}>Door</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="dm-input"
          >
            <option value="front_door">Front Door</option>
            <option value="exit_door">Exit Door</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] mb-1.5" style={{ color: '#8a8a8a' }}>Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={role === 'front_door' ? 'Front phone' : 'Exit phone'}
            className="dm-input"
          />
        </label>
        <button
          type="button"
          onClick={createDevice}
          disabled={busy}
          className="px-5 py-3 rounded-xl font-bold active:scale-[0.98] transition-transform"
          style={{ background: busy ? '#333' : '#16a34a', color: busy ? '#777' : '#fff', fontSize: 14 }}
        >
          Create link
        </button>
      </div>

      {/* Active devices */}
      <div className="text-[12px] font-bold mb-2" style={{ color: '#cfcfcf' }}>Active device links</div>
      {active.length === 0 ? (
        <div className="text-[13px] mb-4" style={{ color: '#8a8a8a' }}>No active device links.</div>
      ) : (
        <div className="divide-y mb-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {active.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2 text-[13px]">
              <span style={{ color: '#cfcfcf' }}>
                {d.label}
                <span style={{ color: '#666' }}> · {ROLE_LABEL[d.device_role] || d.device_role}</span>
                <span style={{ color: '#666' }}> · {d.last_used_at ? `last used ${fmt(d.last_used_at)}` : 'never used'}</span>
              </span>
              <button
                type="button"
                onClick={() => revokeDevice(d.id)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg font-bold text-[12px]"
                style={{ background: '#3a1414', color: '#ff8a8a' }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Revoked history */}
      {revoked.length > 0 && (
        <details>
          <summary className="text-[12px] cursor-pointer" style={{ color: '#8a8a8a' }}>
            Revoked ({revoked.length})
          </summary>
          <div className="divide-y mt-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {revoked.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-2 text-[12px]" style={{ color: '#777' }}>
                <span>{d.label} · {ROLE_LABEL[d.device_role] || d.device_role}</span>
                <span>revoked {fmt(d.revoked_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <style jsx>{`
        :global(.dm-input) {
          width: 100%;
          background: #0e0e0e;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 12px 14px;
          color: #f5f5f5;
          font-size: 16px;
        }
      `}</style>
    </div>
  );
}

function fmt(ts) {
  try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}
