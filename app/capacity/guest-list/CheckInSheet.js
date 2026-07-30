'use client';

import { useEffect, useState } from 'react';
import { validateGuestIntake } from '@/lib/guestlist-checkin';
import SignaturePad from './SignaturePad';

// The check-in flow for one pending entry, as a bottom sheet so the roster stays
// visible behind it and the controls sit under the thumbs holding the tablet.
//
// Three views, chosen by what the server found in guest_profiles:
//   confirm — one known guest with this name (or an already-linked profile):
//             "Is this them, phone ending in ****1234?"
//   pick    — several people share the name: choose, or declare a new guest.
//   intake  — nobody with this name yet: phone + email + a signed consent,
//             collected once, ever.
export default function CheckInSheet({ entry, onClose, onCheckedIn, onConflict }) {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [confirmProfile, setConfirmProfile] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [intake, setIntake] = useState({ phone: '', email: '', signature: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/capacity/guestlist/matches?entryId=${encodeURIComponent(entry.id)}`, {
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Could not check for a returning guest.');
          setView('intake');
          return;
        }
        const list = json.candidates || [];
        setCandidates(list);
        if (json.mode === 'linked' || json.mode === 'single') {
          setConfirmProfile(json.linked || list[0]);
          setView('confirm');
        } else if (json.mode === 'multiple') {
          setView('pick');
        } else {
          setView('intake');
        }
      } catch {
        if (!cancelled) {
          setError('Network error. Collect their details instead.');
          setView('intake');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.id]);

  async function checkIn(payload, message) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/capacity/guestlist/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'check_in', entryId: entry.id, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.code === 'already_resolved') {
          onConflict(json.error || 'That guest was already handled.');
          return;
        }
        setError(json.error || 'Check-in failed.');
        return;
      }
      // The guest is in either way; a warning means the consent record did not
      // land, which the door needs to see but must not be blocked by.
      onCheckedIn(json.entry, json.warning ? `${message} ${json.warning}` : message);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const intakeCheck = validateGuestIntake(intake);
  const isDiscount = entry.comp_type === 'discount';

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.72)' }}>
      <button
        type="button"
        onClick={onClose}
        className="flex-1 w-full"
        aria-label="Cancel check-in"
        style={{ cursor: 'default' }}
      />

      <section
        className="rounded-t-3xl border-t px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[88dvh] overflow-y-auto"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.12)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <div
              className="text-[26px] font-extrabold leading-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {entry.guest_name}
            </div>
            <div className="text-[13px] mt-0.5" style={{ color: '#8a8a8a' }}>
              {entry.partner_name} · {isDiscount ? 'Discounted entry' : 'Free entry'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-4 py-2 rounded-xl text-[13px] font-bold"
            style={{ background: '#1e1e1e', color: '#cfcfcf' }}
          >
            Cancel
          </button>
        </div>

        {isDiscount && (
          <div
            className="rounded-xl px-4 py-3 my-3 border"
            style={{ background: 'rgba(255,184,77,0.1)', borderColor: 'rgba(255,184,77,0.35)' }}
          >
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase mb-0.5" style={{ color: '#ffb84d' }}>
              Apply in the POS
            </div>
            <div className="text-[17px] font-bold" style={{ color: '#ffb84d' }}>
              {entry.discount_detail || 'No discount detail on this grant — ask a manager.'}
            </div>
          </div>
        )}

        {error && (
          <div className="text-[14px] font-semibold my-3" style={{ color: '#ff8a8a' }}>{error}</div>
        )}

        {loading && (
          <div className="text-[15px] py-6" style={{ color: '#8a8a8a' }}>Checking if we&apos;ve met them before…</div>
        )}

        {!loading && view === 'confirm' && confirmProfile && (
          <div className="pt-2">
            <p className="text-[16px] mb-1" style={{ color: '#cfcfcf' }}>
              We&apos;ve met <strong>{confirmProfile.full_name}</strong> before
              {confirmProfile.phone_hint
                ? <> — phone ending in <strong className="tabular-nums">{confirmProfile.phone_hint}</strong>.</>
                : confirmProfile.email_hint
                  ? <> — email <strong>{confirmProfile.email_hint}</strong>.</>
                  : '.'}
            </p>
            <p className="text-[13px] mb-4" style={{ color: '#8a8a8a' }}>
              {firstSeenLabel(confirmProfile)} · No need to collect anything again.
            </p>
            <BigButton
              color="#16a34a"
              disabled={submitting}
              onClick={() => checkIn(
                { guestProfileId: confirmProfile.id },
                `${entry.guest_name} checked in.`,
              )}
            >
              Yes — check in
            </BigButton>
            <SecondaryButton disabled={submitting} onClick={() => { setError(null); setView('intake'); }}>
              No, different person
            </SecondaryButton>
          </div>
        )}

        {!loading && view === 'pick' && (
          <div className="pt-2">
            <p className="text-[15px] mb-3" style={{ color: '#cfcfcf' }}>
              {candidates.length} people on record share this name. Which one is at the door?
            </p>
            <ul className="space-y-2 mb-3">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => checkIn(
                      { guestProfileId: candidate.id },
                      `${entry.guest_name} checked in.`,
                    )}
                    className="w-full text-left rounded-2xl px-4 py-3 border active:scale-[0.99] transition-transform"
                    style={{ background: '#0e0e0e', borderColor: 'rgba(255,255,255,0.12)' }}
                  >
                    <div className="text-[16px] font-bold tabular-nums">
                      {candidate.phone_hint || candidate.email_hint || 'No contact details on file'}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: '#8a8a8a' }}>
                      {candidate.email_hint && candidate.phone_hint ? `${candidate.email_hint} · ` : ''}
                      {firstSeenLabel(candidate)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <SecondaryButton disabled={submitting} onClick={() => { setError(null); setView('intake'); }}>
              None of these — new guest
            </SecondaryButton>
          </div>
        )}

        {!loading && view === 'intake' && (
          <form
            className="pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!intakeCheck.valid) { setError(intakeCheck.error); return; }
              checkIn(
                { newGuest: intakeCheck.data },
                `${entry.guest_name} checked in — new guest saved.`,
              );
            }}
          >
            <p className="text-[14px] mb-3" style={{ color: '#8a8a8a' }}>
              First time here. Collect this once and they never have to do it again.
            </p>

            <label className="block mb-3">
              <span className="block text-[12px] mb-1.5" style={{ color: '#8a8a8a' }}>Phone number</span>
              <input
                value={intake.phone}
                onChange={(e) => setIntake((p) => ({ ...p, phone: e.target.value }))}
                className="sheet-input"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(512) 555-0100"
              />
            </label>

            <label className="block mb-3">
              <span className="block text-[12px] mb-1.5" style={{ color: '#8a8a8a' }}>Email</span>
              <input
                value={intake.email}
                onChange={(e) => setIntake((p) => ({ ...p, email: e.target.value }))}
                className="sheet-input"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="name@email.com"
              />
            </label>

            <div
              className="rounded-2xl px-4 py-4 mb-4 border"
              style={{ background: '#0e0e0e', borderColor: 'rgba(255,255,255,0.12)' }}
            >
              <p className="text-[14px] mb-3" style={{ color: '#cfcfcf' }}>
                Your signature confirms it&apos;s OK to contact you by text and email at the
                number and address above.
              </p>
              <SignaturePad
                disabled={submitting}
                onChange={(signature) => setIntake((p) => ({ ...p, signature }))}
              />
            </div>

            <BigButton color="#16a34a" disabled={submitting || !intakeCheck.valid} type="submit">
              Save &amp; check in
            </BigButton>
            {(confirmProfile || candidates.length > 0) && (
              <SecondaryButton
                disabled={submitting}
                onClick={() => {
                  setError(null);
                  setView(confirmProfile ? 'confirm' : 'pick');
                }}
              >
                Back to matches
              </SecondaryButton>
            )}
          </form>
        )}

        <style jsx>{`
          :global(.sheet-input) {
            width: 100%;
            background: #0e0e0e;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px;
            padding: 14px 16px;
            color: #f5f5f5;
            font-size: 17px;
          }
          :global(.sheet-input:focus) {
            outline: none;
            border-color: rgba(124, 252, 155, 0.5);
          }
        `}</style>
      </section>
    </div>
  );
}

function BigButton({ children, color, disabled, onClick, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl py-5 text-[20px] font-extrabold active:scale-[0.98] transition-transform"
      style={{
        background: disabled ? '#333' : color,
        color: disabled ? '#777' : '#fff',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full mt-2 rounded-2xl py-4 text-[15px] font-bold"
      style={{ background: '#1e1e1e', color: '#cfcfcf' }}
    >
      {children}
    </button>
  );
}

function firstSeenLabel(profile) {
  if (profile?.first_seen_event?.title) return `First seen at ${profile.first_seen_event.title}`;
  if (profile?.created_at) {
    try {
      return `On file since ${new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
    } catch {
      return 'On file';
    }
  }
  return 'On file';
}
