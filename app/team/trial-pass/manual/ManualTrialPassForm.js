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

export default function ManualTrialPassForm({ createdByEmail }) {
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Field
        label="Full legal name"
        name="fullName"
        type="text"
        autoComplete="name"
        placeholder="Jane Doe"
        value={values.fullName}
        onChange={update('fullName')}
        bad={badField === 'fullName'}
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
      />

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 w-full px-7 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
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

function Field({ label, name, type, autoComplete, placeholder, value, onChange, bad }) {
  return (
    <label className="block">
      <span
        className="block text-[10px] font-semibold tracking-[0.16em] mb-2"
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
        className="w-full px-5 py-4 rounded-xl text-[16px] outline-none border transition-colors"
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
