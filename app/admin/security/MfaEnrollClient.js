'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// Functional TOTP enrollment for admins/team using Supabase Auth MFA.
//
// IMPORTANT: This component performs REAL enrollment against Supabase
// (enroll -> challenge -> verify). It is NOT a mock. However, MFA is not yet
// *enforced* on any route — enforcement flips on via the ENFORCE_ADMIN_MFA
// server flag once everyone has enrolled (see lib/auth-helpers requireAdminMfa).
export default function MfaEnrollClient() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Enrollment-in-progress state
  const [enrolling, setEnrolling] = useState(false);
  const [pending, setPending] = useState(null); // { factorId, qr, secret }
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { data, error: listErr } = await supabase.auth.mfa.listFactors();
      if (listErr) throw listErr;
      setFactors(data?.totp || []);
    } catch (err) {
      setError(err.message || 'Failed to load MFA factors');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { refresh(); }, [refresh]);

  async function startEnroll() {
    setError(null); setNotice(null); setEnrolling(true);
    try {
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Authenticator ${new Date().toLocaleDateString()}`,
      });
      if (enrollErr) throw enrollErr;
      setPending({
        factorId: data.id,
        qr: data.totp?.qr_code || null,
        secret: data.totp?.secret || null,
      });
    } catch (err) {
      setError(err.message || 'Enrollment failed');
      setEnrolling(false);
    }
  }

  async function verify() {
    if (!pending || !code.trim()) return;
    setVerifying(true); setError(null);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: pending.factorId,
      });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: pending.factorId,
        challengeId: ch.id,
        code: code.trim(),
      });
      if (vErr) throw vErr;
      setNotice('Authenticator verified and active.');
      setPending(null);
      setEnrolling(false);
      setCode('');
      await refresh();
    } catch (err) {
      setError(err.message || 'Verification failed — check the 6-digit code.');
    } finally {
      setVerifying(false);
    }
  }

  async function cancelEnroll() {
    if (pending?.factorId) {
      try { await supabase.auth.mfa.unenroll({ factorId: pending.factorId }); } catch { /* noop */ }
    }
    setPending(null); setEnrolling(false); setCode('');
  }

  async function removeFactor(factorId) {
    setError(null); setNotice(null);
    try {
      const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId });
      if (unErr) throw unErr;
      setNotice('Authenticator removed.');
      await refresh();
    } catch (err) {
      setError(err.message || 'Failed to remove factor');
    }
  }

  if (loading) {
    return <p className="text-[13px]" style={{ color: '#8a8a8a' }}>Loading MFA status…</p>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-[10px] text-[13px]" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#86efac' }}>
          {notice}
        </div>
      )}

      <div className="rounded-[14px] border p-5" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
        <h2 className="text-[14px] font-semibold tracking-[0.10em] uppercase mb-3" style={{ color: '#8a8a8a' }}>
          Authenticator Apps
        </h2>

        {factors.length === 0 ? (
          <p className="text-[13px] mb-4" style={{ color: '#8a8a8a' }}>
            No authenticator enrolled. Add one to secure your account with a second factor.
          </p>
        ) : (
          <ul className="space-y-2 mb-4">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-[10px] border p-3"
                style={{ background: '#0d0d0d', borderColor: 'rgba(255,255,255,0.06)' }}>
                <div className="text-[13px]">
                  <span className="font-semibold">{f.friendly_name || 'Authenticator'}</span>
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-[4px]"
                    style={{ background: f.status === 'verified' ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)', color: f.status === 'verified' ? '#4ade80' : '#8a8a8a' }}>
                    {f.status}
                  </span>
                </div>
                <button onClick={() => removeFactor(f.id)}
                  className="text-[12px] px-3 py-1.5 rounded-[8px]"
                  style={{ border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {!enrolling && (
          <button onClick={startEnroll}
            className="px-5 py-2.5 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
            style={{ background: 'white', color: 'black' }}>
            Add authenticator
          </button>
        )}

        {enrolling && pending && (
          <div className="mt-4 space-y-3">
            {pending.qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pending.qr} alt="Scan this QR code in your authenticator app"
                width={180} height={180}
                className="rounded-[10px] bg-white p-2" />
            )}
            {pending.secret && (
              <p className="text-[12px]" style={{ color: '#8a8a8a' }}>
                Or enter this key manually: <code className="text-white">{pending.secret}</code>
              </p>
            )}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              placeholder="6-digit code"
              className="w-full max-w-[200px] px-3 py-2.5 text-[14px] rounded-[10px] outline-none"
              style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.08)', color: 'white' }}
            />
            <div className="flex gap-2">
              <button onClick={verify} disabled={verifying || !code.trim()}
                className="px-5 py-2 text-[13px] font-semibold rounded-[10px] tracking-[0.06em] uppercase"
                style={{ background: 'white', color: 'black', opacity: verifying || !code.trim() ? 0.6 : 1 }}>
                {verifying ? 'Verifying…' : 'Verify & activate'}
              </button>
              <button onClick={cancelEnroll} disabled={verifying}
                className="px-4 py-2 text-[13px] rounded-[10px]"
                style={{ border: '1px solid rgba(255,255,255,0.10)', color: 'white' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[12px]" style={{ color: '#6a6a6a' }}>
        Two-factor authentication is currently <strong>optional</strong>. Once all admins and team
        members have enrolled, it will be required at sign-in.
      </p>
    </div>
  );
}
