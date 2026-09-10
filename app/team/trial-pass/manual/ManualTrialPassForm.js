'use client';

import { useState } from 'react';

// Two states: form (staff types the guest's info) and result (pass created,
// staff shows the link/QR to the guest). Not persisted — a refresh clears
// the screen because the pass is safely on the server and in the guest's
// email at this point.
//
// All colours below are theme tokens so the page reads correctly under both
// the admin shell's dark and light themes. Inputs get their background,
// border and text from the `.auth-theme-root input` rule in globals.css,
// which is why the `<input>` element itself carries no inline colour styles.

// compact=true renders a denser variant used inside the front-desk console
// where vertical space competes with the roster + recent-activity panels.
// The regular /team/trial-pass/manual page still gets the roomy layout.
export default function ManualTrialPassForm({ createdByEmail, compact = false }) {
  const [values, setValues] = useState({ fullName: '', phone: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [badField, setBadField] = useState(null);
  const [result, setResult] = useState(null);

  const update = (name) => (event) => {
    setValues((prev) => ({ ...prev, [name]: event.target.value }));
    if (badField === name) setBadField(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setBadField(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/team/trial-pass/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Something went wrong — try again.');
        setBadField(body?.field || null);
        return;
      }
      setResult(body);
    } catch {
      setError('No connection. Check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setValues({ fullName: '', phone: '', email: '' });
    setResult(null);
    setError('');
    setBadField(null);
  };

  if (result) {
    return (
      <div>
        <div
          className="rounded-xl p-5 mb-6 border"
          style={{
            background: 'var(--auth-success-bg)',
            borderColor: 'var(--auth-success-border)',
          }}
        >
          <div
            className="text-[10px] font-semibold tracking-[0.18em] mb-2"
            style={{ color: 'var(--auth-success)' }}
          >
            {result.existing ? 'PASS REISSUED' : 'PASS CREATED'}
          </div>
          <div className="text-[16px] font-semibold mb-1" style={{ color: 'var(--auth-text-strong)' }}>
            {result.fullName}
          </div>
          <div className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
            {result.email} · {result.phone}
          </div>
          <div className="text-[13px] mt-2" style={{ color: 'var(--auth-muted)' }}>
            Good through{' '}
            <span style={{ color: 'var(--auth-text-strong)', fontWeight: 600 }}>
              {result.expiresLabel}
            </span>
            {result.emailed ? ' · pass emailed' : ' · email failed to send'}
          </div>
          <AccountStatusLines result={result} />
        </div>

        <div
          className="rounded-xl p-5 mb-6 border"
          style={{
            background: 'var(--auth-card-bg)',
            borderColor: 'var(--auth-card-border)',
          }}
        >
          <div
            className="text-[10px] font-semibold tracking-[0.16em] mb-2"
            style={{ color: 'var(--auth-muted)' }}
          >
            PASS URL
          </div>
          <a
            href={result.passUrl}
            className="block text-[13px] break-all underline mb-3"
            style={{ color: 'var(--auth-text-strong)' }}
            target="_blank"
            rel="noopener noreferrer"
          >
            {result.passUrl}
          </a>
          <p className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
            Open this on the guest&apos;s phone so they can save it, or wait for the email.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="auth-theme-solid-button flex-1 px-6 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em]"
          >
            CREATE ANOTHER
          </button>
        </div>

        {createdByEmail ? (
          <p
            className="text-[11px] mt-5 leading-[1.6]"
            style={{ color: 'var(--auth-faint)' }}
          >
            Recorded as created by {createdByEmail}.
          </p>
        ) : null}
      </div>
    );
  }

  const formGap = compact ? 'gap-2.5' : 'gap-4';
  const buttonClass = compact
    ? 'mt-1 w-full px-5 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.14em] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0'
    : 'mt-2 w-full px-7 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0';

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col ${formGap}`} noValidate>
      <Field
        label="Full legal name"
        name="fullName"
        type="text"
        autoComplete="name"
        placeholder="Jane Doe"
        value={values.fullName}
        onChange={update('fullName')}
        bad={badField === 'fullName'}
        compact={compact}
      />
      <Field
        label="Mobile phone number"
        name="phone"
        type="tel"
        autoComplete="tel"
        placeholder="(512) 555-0134"
        value={values.phone}
        onChange={update('phone')}
        bad={badField === 'phone'}
        compact={compact}
      />
      <Field
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="jane@email.com"
        value={values.email}
        onChange={update('email')}
        bad={badField === 'email'}
        compact={compact}
      />

      <button
        type="submit"
        disabled={submitting}
        className={buttonClass}
        style={{
          background: 'var(--auth-accent)',
          color: 'var(--auth-accent-text)',
        }}
      >
        {submitting ? 'CREATING PASS...' : 'CREATE TRIAL PASS'}
      </button>

      {error && (
        <p
          className="text-[12px] mt-1 text-center"
          style={{ color: 'var(--auth-danger)' }}
          role="alert"
        >
          {error}
        </p>
      )}

      <p
        className="text-[11px] mt-4 text-center leading-[1.6]"
        style={{ color: 'var(--auth-faint)' }}
      >
        This bypasses SMS verification. Only use for guests who genuinely can&apos;t receive a code.
      </p>
    </form>
  );
}

// What staff needs to be able to say out loud, honestly, while the guest is
// still standing there. Account provisioning and the invite email are
// best-effort around the pass — the API issues the pass either way — so the
// partial-failure case is a real outcome and gets its own line rather than
// being hidden behind the happy path.
//
// 13px, not the 10–11px used for the labels above: this is copy staff has to
// read at a glance under front-desk lighting, and it can carry an instruction.
// Nothing in here goes below 12px.
function AccountStatusLines({ result }) {
  // A response from before this change (or a client cached across a deploy)
  // carries none of these keys. Render nothing rather than reporting a
  // failure that never happened.
  const hasAccountInfo = 'accountLinked' in result
    || 'accountCreated' in result
    || 'inviteEmailed' in result;
  if (!hasAccountInfo) return null;

  let accountLine;
  let accountOk = true;
  if (result.accountCreated) {
    accountLine = 'Account created and linked to this pass.';
  } else if (result.accountLinked) {
    accountLine = result.accountReused
      ? 'Linked to the existing account for this email.'
      : 'Linked to an account.';
  } else {
    accountOk = false;
    accountLine = 'No account linked. The pass works at the door, but no ticket discount until it is.';
  }

  let inviteLine = null;
  if (result.accountCreated) {
    inviteLine = result.inviteEmailed
      ? 'Sign-in link emailed — ask them to finish their profile.'
      : 'Sign-in link did not send. They can sign in with this email from the site.';
  } else if (result.accountReused) {
    inviteLine = 'No sign-in link sent — they already have an account to sign in with.';
  }

  const inviteFailed = Boolean(result.accountCreated) && !result.inviteEmailed;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--auth-success-border)' }}>
      <div
        className="text-[13px] leading-[1.5]"
        style={{ color: accountOk ? 'var(--auth-text-strong)' : 'var(--auth-danger)' }}
      >
        {accountLine}
      </div>
      {inviteLine ? (
        <div
          className="text-[13px] leading-[1.5] mt-1"
          style={{ color: inviteFailed ? 'var(--auth-danger)' : 'var(--auth-muted)' }}
        >
          {inviteLine}
        </div>
      ) : null}
      <div className="text-[12px] leading-[1.5] mt-2" style={{ color: 'var(--auth-muted)' }}>
        Trial accounts get up to 25% off Weekend Music Experience tickets while signed in.
      </div>
    </div>
  );
}

function Field({ label, name, type, autoComplete, placeholder, value, onChange, bad, compact = false }) {
  const labelClass = compact
    ? 'block text-[9px] font-semibold tracking-[0.16em] mb-1'
    : 'block text-[10px] font-semibold tracking-[0.16em] mb-2';
  // text-[16px] preserved even in compact mode: iOS Safari zooms the whole
  // viewport if a focused <input> is under 16px, which would blow up the
  // scanner layout on iPad.
  const inputClass = compact
    ? 'w-full px-3 py-2 rounded-lg text-[16px] outline-none border transition-colors'
    : 'w-full px-5 py-4 rounded-xl text-[16px] outline-none border transition-colors';
  return (
    <label className="block">
      <span
        className={labelClass}
        style={{ color: 'var(--auth-muted)' }}
      >
        {label.toUpperCase()}
      </span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className={inputClass}
        // Bad-field indicator uses an outline rather than inline
        // border-color: globals.css pins every input's border to
        // var(--auth-input-border) with !important so an inline
        // border-color cannot override it. Outline is unaffected.
        style={
          bad
            ? { outline: '2px solid var(--auth-danger)', outlineOffset: '-2px' }
            : undefined
        }
      />
    </label>
  );
}
