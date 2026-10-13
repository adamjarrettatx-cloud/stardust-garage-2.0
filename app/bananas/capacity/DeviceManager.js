'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { qrMatrixToSvg } from '@/lib/qr-code';
import styles from './workspace.module.css';

// Admin-only door-device provisioning UI. Lets Adam mint a revocable setup link
// for each Jelly2 (Front Door / Exit Door), copy it once, open it on the phone,
// and revoke it later. Talks to /api/capacity/devices (admin-gated). The raw
// token / setup URL is returned exactly ONCE on create and shown here until the
// admin dismisses it — it cannot be retrieved again.

const ROLE_LABEL = { front_door: 'Front Door', exit_door: 'Exit Door' };

export default function DeviceManager({ onCountChange }) {
  const [devices, setDevices] = useState([]);
  const [role, setRole] = useState('front_door');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [justCreated, setJustCreated] = useState(null); // { setup_url, device }
  const [copied, setCopied] = useState(false);

  // Encode the full setup URL (including ?token=...) into a scannable QR so the
  // Jelly2 never has to type it. Built client-side from the URL already shown —
  // the token is not persisted anywhere new. Memoized on the URL string.
  const qrSvg = useMemo(
    () => (justCreated?.setup_url
      ? qrMatrixToSvg(justCreated.setup_url, { size: 220, dark: '#0a0a0a', light: '#ffffff' })
      : null),
    [justCreated?.setup_url],
  );

  // Short manual-fallback alias of the setup URL (origin + /c/f|/c/e + token),
  // matching the redirects in next.config.mjs. Shown so the token can be typed
  // by hand on the Jelly2 if scanning fails — the token still rides along.
  const shortUrl = useMemo(() => {
    if (!justCreated?.setup_url) return null;
    try {
      const u = new URL(justCreated.setup_url);
      const seg = justCreated.device?.device_role === 'exit_door' ? 'e' : 'f';
      // searchParams.get() decodes the token; re-encode so the displayed short
      // URL stays valid even if the token alphabet ever stops being base64url.
      return `${u.origin}/c/${seg}?token=${encodeURIComponent(u.searchParams.get('token') ?? '')}`;
    } catch { return null; }
  }, [justCreated?.setup_url, justCreated?.device?.device_role]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/capacity/devices', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setDevices(json.devices || []);
        onCountChange?.((json.devices || []).filter((d) => d.active && !d.revoked_at).length);
      }
    } catch { /* ignore */ }
  }, [onCountChange]);

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
        setMsg(`${ROLE_LABEL[role]} link created. Scan the QR or copy it now — it won’t be shown again.`);
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
  const roleName = ROLE_LABEL[justCreated?.device?.device_role] || 'Device';

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Add a door device</h2>
            <p className={styles.panelSub}>Each phone gets its own revocable link. It stays signed in as that door with no team login or 2FA.</p>
          </div>
        </div>
        <ol className={styles.steps}>
          <li>Pick the door, add a label, and create the link.</li>
          <li>Scan the QR with that phone’s camera, or copy the full link. Keep the tab open or add it to the home screen.</li>
          <li>Revoke the link any time to cut the phone off instantly.</li>
        </ol>
        <div className={styles.createGrid}>
          <label className={styles.field}>Door
            <select value={role} onChange={(e) => setRole(e.target.value)} className={styles.input}>
              <option value="front_door">Front Door (+1)</option>
              <option value="exit_door">Exit Door (−1)</option>
            </select>
          </label>
          <label className={styles.field}>Label (optional)
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={role === 'front_door' ? 'Front phone' : 'Exit phone'} className={styles.input} />
          </label>
          <button type="button" onClick={createDevice} disabled={busy} className={`${styles.btn} ${styles.btnPrimary}`}>Create link</button>
        </div>
        {(msg || error) && <div className={`${styles.flash} ${error ? styles.flashErr : styles.flashOk}`} role="status">{error || msg}</div>}

        {/* One-time setup URL + QR. The raw token lives only in client memory
            and can never be fetched again; Done clears it. */}
        {justCreated?.setup_url && (
          <div className={styles.oneTime}>
            <div className={styles.oneTimeHead}>{roleName} setup link · shown only once</div>
            <div className={styles.warnBox}>
              <strong>Don’t type this link by hand.</strong> Scan the QR or use Copy. The <code>?token=…</code> part must stay attached or the phone will show not authorized.
              {shortUrl && <> Short form if you must type it: <code>{shortUrl}</code></>}
            </div>
            <div className={styles.oneTimeBody}>
              {qrSvg
                ? <div className={styles.qr} aria-label={`${roleName} setup QR code`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
                : <div className={styles.flashErr}>Couldn’t render a QR. Use Copy full link instead.</div>}
              <div style={{ minWidth: 0 }}>
                <div className={`${styles.urlBox} ${styles.mono}`}>{justCreated.setup_url}</div>
                <div className={styles.btnRow}>
                  <button type="button" onClick={() => copyUrl(justCreated.setup_url)} className={`${styles.btn} ${styles.btnPrimary}`}>{copied ? 'Copied' : 'Copy full link'}</button>
                  <a href={justCreated.setup_url} target="_blank" rel="noopener noreferrer" className={`${styles.btn} ${styles.linkBtn}`}>Open link</a>
                  <button type="button" onClick={() => setJustCreated(null)} className={styles.btn}>Done</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Active device links</h2>
            <p className={styles.panelSub}>Every count from these phones is logged under its label.</p>
          </div>
        </div>
        {active.length === 0 ? <div className={styles.empty}>No active device links.</div> : (
          <div className={styles.rows}>
            {active.map((d) => (
              <div key={d.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div className={styles.rowSub}>{ROLE_LABEL[d.device_role] || d.device_role} · {d.last_used_at ? `last used ${fmt(d.last_used_at)}` : 'never used'}</div>
                </div>
                <button type="button" onClick={() => revokeDevice(d.id)} disabled={busy} className={`${styles.btn} ${styles.btnSmall} ${styles.btnDanger}`}>Revoke</button>
              </div>
            ))}
          </div>
        )}
        {revoked.length > 0 && (
          <details className={styles.revoked} style={{ marginTop: 10 }}>
            <summary>Revoked links ({revoked.length})</summary>
            <div className={styles.rows}>
              {revoked.map((d) => (
                <div key={d.id} className={styles.row}>
                  <span className={styles.rowSub}>{d.label} · {ROLE_LABEL[d.device_role] || d.device_role}</span>
                  <span className={styles.rowRight}>revoked {fmt(d.revoked_at)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
    </>
  );
}

function fmt(ts) {
  try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}
