'use client';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export default function StationManagement() {
  const [stations, setStations] = useState(null);
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [role, setRole] = useState('security');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const inputStyle = { background: 'var(--auth-input-bg)', borderColor: 'var(--auth-input-border)', color: 'var(--auth-input-text)' };
  const field = 'w-full rounded-lg border p-3 text-base';
  const button = 'rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50';
  async function load() {
    setError(''); setBusy(true);
    try { setStations((await adminFetch('/api/admin/stations')).stations); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function mutate(body) {
    setBusy(true); setError('');
    try {
      const data = await adminFetch('/api/admin/stations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (data.password) setCredential({ username: data.station?.username || data.username, password: data.password });
      setConfirm(null);
      if (body.action === 'create') { setUsername(''); setLabel(''); }
      setStations((await adminFetch('/api/admin/stations')).stations);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border p-5 mb-8" style={{ borderColor: 'var(--auth-card-border)' }}>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-xl font-bold">Shared station accounts</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--auth-muted)' }}>Username and password only. Security or Front Desk access. Owner MFA required.</p></div>
      <button className={button} onClick={load} disabled={busy}>{stations ? 'Refresh stations' : 'Manage stations'}</button>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
    {credential && <div className="mt-5 border rounded-lg p-4" style={{ borderColor: 'var(--auth-card-border)' }}>
      <h3 className="font-semibold">Save this password now</h3>
      <p className="text-sm mt-2">It is shown once and cannot be retrieved. Store it in your password manager and share it only with authorized station operators.</p>
      <dl className="my-4 text-sm"><dt>Username</dt><dd className="font-mono mb-2">{credential.username}</dd>
        <dt>Password</dt><dd className="font-mono break-all select-all">{credential.password}</dd></dl>
      <button className={button} onClick={() => setCredential(null)}>I saved it. Hide password.</button>
    </div>}
    {stations && <>
      <div className="mt-6 space-y-3">
        {stations.length === 0 && <p className="text-sm">No station accounts yet.</p>}
        {stations.map(station => <div key={station.id} className="flex flex-wrap items-center justify-between gap-4 border-t pt-4" style={{ borderColor: 'var(--auth-card-border)' }}>
          <div><p className="font-semibold">{station.label}</p>
            <p className="text-sm mt-1">{station.username} · {station.role === 'security' ? 'Security' : 'Front Desk'} · {station.reset_started_at ? 'Locked for password reset' : station.active ? 'Enabled' : 'Disabled'}</p></div>
          <div className="flex flex-wrap gap-2">
            {[['reset', 'Rotate password'], ['revoke', 'Sign out all devices'], [station.active ? 'disable' : 'enable', station.active ? 'Disable' : 'Enable']].map(([action, title]) =>
              <button key={action} className={button} disabled={busy || !!credential} onClick={() => setConfirm({ id: station.id, action, title, username: station.username })}>{title}</button>)}
          </div>
        </div>)}
      </div>
      {confirm && <div role="alertdialog" aria-label="Confirm station access change" className="mt-5 p-4 border rounded-lg">
        <p className="text-sm">{confirm.title} for <strong>{confirm.username}</strong>? This invalidates all current sessions for this station.</p>
        <div className="flex gap-3 mt-3"><button disabled={busy} className={button} onClick={() => mutate({ id: confirm.id, action: confirm.action })}>Confirm</button>
          <button disabled={busy} className={button} onClick={() => setConfirm(null)}>Cancel</button></div>
      </div>}
      <form className="mt-6 border-t pt-5 space-y-4" style={{ borderColor: 'var(--auth-card-border)' }} onSubmit={e => { e.preventDefault(); void mutate({ action: 'create', username, label, role }); }}>
        <h3 className="font-semibold">Create station</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm">Station name<input className={`${field} mt-2`} style={inputStyle} value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="Security" required disabled={busy} /></label>
          <label className="text-sm">Username<input className={`${field} mt-2`} style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} pattern="[A-Za-z][A-Za-z0-9-]{2,31}" maxLength={32} placeholder="security" required disabled={busy} /></label>
          <label className="text-sm">Role<select className={`${field} mt-2`} style={inputStyle} value={role} onChange={e => setRole(e.target.value)} disabled={busy}>
            <option value="security">Security</option><option value="front_desk">Front Desk</option></select></label>
        </div>
        <p className="text-sm" style={{ color: 'var(--auth-muted)' }}>A strong password is generated automatically. Sessions last up to 12 hours. No staff email address is required.</p>
        <button className={button} disabled={busy || !!credential}>{busy ? 'Working…' : 'Create station and generate password'}</button>
      </form>
      <p className="text-sm mt-5">Station sign-in address: <a className="underline" href="/staff/login">/staff/login</a>. History identifies the shared station, not the person using it.</p>
    </>}
  </section>;
}
