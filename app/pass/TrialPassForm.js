'use client';

import { useMemo, useState } from 'react';
import { qrMatrixToSvg } from '@/lib/qr-code';

// The three-question intake form behind the printed QR codes in the venue,
// the SMS-verification step it turns into, and the success state after that.
//
// One component, three states (form → verify → pass). No navigation between
// them: the guest is standing up, probably holding a drink, on venue wifi.
// A redirect to a separate route is one more thing that can spin. Every step
// hands its result straight into the next.
//
// The token is never written to localStorage or a cookie. It lives in this
// component's state for as long as the page is open, and in the guest's email
// forever — which is why the email is sent from issueTrialPass.

const FIELDS = [
  { name: 'fullName', label: 'Full legal name', type: 'text', autoComplete: 'name', placeholder: 'Jane Doe' },
  { name: 'phone', label: 'Mobile phone number', type: 'tel', autoComplete: 'tel', placeholder: '(512) 555-0134' },
  { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email', placeholder: 'you@email.com' },
];

// Step names, kept in a const so the JSX below reads clean.
const STEP_FORM = 'form';
const STEP_VERIFY = 'verify';
const STEP_PASS = 'pass';

export default function TrialPassForm() {
  const [step, setStep] = useState(STEP_FORM);
  const [values, setValues] = useState({ fullName: '', phone: '', email: '' });
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState('sms');
  const [existing, setExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [badField, setBadField] = useState(null);
  const [pass, setPass] = useState(null); // { passUrl, expiresLabel, emailed, fullName }

  // Drawn from the returned pass URL, client-side. Light modules stay pure
  // white and dark ones near-black regardless of the page's dark background —
  // a scanner needs the contrast, and an inverted QR does not read.
  const qrSvg = useMemo(
    () => (pass?.passUrl ? qrMatrixToSvg(pass.passUrl, { size: 260, dark: '#0a0a0a', light: '#ffffff' }) : null),
    [pass?.passUrl],
  );

  const update = (name) => (event) => {
    setValues((prev) => ({ ...prev, [name]: event.target.value }));
    if (badField === name) setBadField(null);
  };

  // Step 1 → 2: send the code.
  const startVerification = async (event) => {
    event?.preventDefault?.();
    if (submitting) return;
    setError('');
    setBadField(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/trial-pass/verify/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, channel: 'sms' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Something went wrong — try again.');
        setBadField(body?.field || null);
        return;
      }
      setChannel(body?.channel === 'call' ? 'call' : 'sms');
      setExisting(Boolean(body?.existing));
      setCode('');
      setStep(STEP_VERIFY);
    } catch {
      setError('No connection. Check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Voice fallback: guest taps "Text not arriving? Call me instead."
  const requestCall = async () => {
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/trial-pass/verify/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, channel: 'call' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Could not call you — try text again or see the front desk.');
        return;
      }
      setChannel('call');
      setCode('');
    } catch {
      setError('No connection. Check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Same as startVerification but no navigation change — guest hits Resend
  // and Twilio decides whether to actually re-send or extend the existing
  // code. Errors show on the same verify screen.
  const resendCode = async () => {
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/trial-pass/verify/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, channel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body?.error || 'Could not resend — try again.');
    } catch {
      setError('No connection. Check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 → 3: check the code and receive the pass.
  const submitCode = async (event) => {
    event?.preventDefault?.();
    if (submitting) return;
    setError('');
    setBadField(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/trial-pass/verify/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Something went wrong — try again.');
        setBadField(body?.field || null);
        return;
      }
      setPass(body);
      setStep(STEP_PASS);
    } catch {
      setError('No connection. Check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------
  // Step 3 — pass ready
  // ---------------------------------------------------------------------
  if (step === STEP_PASS && pass) {
    return (
      <div className="max-w-[440px] mx-auto text-center">
        <h1
          className="text-[30px] md:text-[36px] font-extrabold -tracking-[0.02em] leading-[1.15] mb-3"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#ffffff' }}
        >
          Your Trial SDG Pass is Ready
        </h1>
        <p className="text-[14px] leading-[1.6] mb-7" style={{ color: 'rgba(255,255,255,0.65)' }}>
          Show this code at the door for faster check-in.
          {pass.emailed ? ' We also sent it to your email in case you need it later.' : ''}
        </p>

        {qrSvg ? (
          <div className="flex flex-col items-center">
            <div
              className="rounded-2xl p-4"
              style={{ background: '#ffffff' }}
              aria-label="Your Trial SDG Pass QR code"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Open your pass at{' '}
            <a href={pass.passUrl} className="underline" style={{ color: '#ffffff' }}>
              this link
            </a>
            .
          </p>
        )}

        <div
          className="mt-7 rounded-xl px-5 py-4 text-left"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="text-[10px] font-semibold tracking-[0.16em] mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            GOOD THROUGH
          </div>
          <div className="text-[15px] font-semibold" style={{ color: '#ffffff' }}>
            {pass.expiresLabel}
          </div>
        </div>

        <a
          href={pass.passUrl}
          className="inline-block mt-6 px-7 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-transform hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          SAVE MY PASS
        </a>

        <p className="text-[11px] mt-5 leading-[1.6]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Your pass is checked automatically when scanned. It covers Friday through Sunday music events.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Step 2 — verify screen
  // ---------------------------------------------------------------------
  if (step === STEP_VERIFY) {
    const isCall = channel === 'call';
    return (
      <div className="max-w-[440px] mx-auto">
        <div className="text-center mb-8">
          <div
            className="inline-block text-[10px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-5"
            style={{ color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.18)' }}
          >
            STEP 2 OF 2
          </div>
          <h1
            className="text-[28px] md:text-[34px] font-extrabold -tracking-[0.02em] leading-[1.15] mb-4"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#ffffff' }}
          >
            {isCall ? 'Answer the call.' : 'Check your texts.'}
          </h1>
          <p className="text-[14px] leading-[1.6]" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {isCall
              ? `We're calling ${values.phone} with a 6-digit code.`
              : `We just texted a 6-digit code to ${values.phone}.`}
            {existing ? ' Welcome back — enter the code to pull up your pass.' : ''}
          </p>
        </div>

        <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
          <label className="block">
            <span
              className="block text-[10px] font-semibold tracking-[0.16em] mb-2"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              6-DIGIT CODE
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                if (badField === 'code') setBadField(null);
              }}
              placeholder="123456"
              required
              className="w-full px-5 py-4 rounded-xl text-[20px] tracking-[0.4em] text-center outline-none border transition-colors"
              style={{
                background: 'rgba(255,255,255,0.05)',
                borderColor: badField === 'code' ? '#c53030' : 'rgba(255,255,255,0.14)',
                color: '#ffffff',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            />
          </label>

          <button
            type="submit"
            disabled={submitting || code.length < 4}
            className="mt-2 w-full px-7 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            {submitting ? 'CHECKING...' : 'GET MY SDG PASS'}
          </button>
        </form>

        {error && (
          <p className="text-[12px] mt-3 text-center" style={{ color: '#ff8a8a' }} role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col items-center gap-2 mt-6 text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
          <button
            type="button"
            onClick={resendCode}
            disabled={submitting}
            className="underline disabled:opacity-40"
          >
            {isCall ? 'Call me again' : 'Resend text'}
          </button>
          {!isCall ? (
            <button
              type="button"
              onClick={requestCall}
              disabled={submitting}
              className="underline disabled:opacity-40"
            >
              Text not arriving? Call me instead.
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setStep(STEP_FORM);
              setError('');
              setBadField(null);
            }}
            className="underline"
          >
            Wrong number? Go back
          </button>
        </div>

        <p className="text-[11px] mt-6 text-center leading-[1.6]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Phone dead or number won&apos;t receive? Come to the front desk — staff can sign you up.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Step 1 — 3-question form
  // ---------------------------------------------------------------------
  return (
    <div className="max-w-[440px] mx-auto">
      <div className="text-center mb-8">
        <div
          className="inline-block text-[10px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-5"
          style={{ color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.18)' }}
        >
          FIRST TIME HERE
        </div>
        <h1
          className="text-[32px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#ffffff' }}
        >
          Get your trial pass.
        </h1>
        <p className="text-[14px] leading-[1.6]" style={{ color: 'rgba(255,255,255,0.65)' }}>
          Three questions, 30 days of access to Friday through Sunday music events, and a code that
          gets you through the door faster.
        </p>
      </div>

      <form onSubmit={startVerification} className="flex flex-col gap-4" noValidate>
        {FIELDS.map((field) => (
          <label key={field.name} className="block">
            <span
              className="block text-[10px] font-semibold tracking-[0.16em] mb-2"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              {field.label.toUpperCase()}
            </span>
            <input
              type={field.type}
              name={field.name}
              value={values[field.name]}
              onChange={update(field.name)}
              placeholder={field.placeholder}
              autoComplete={field.autoComplete}
              required
              // 16px minimum so mobile Safari does not zoom the page on focus
              // and leave the guest scrolled sideways mid-form.
              className="w-full px-5 py-4 rounded-xl text-[16px] outline-none border transition-colors"
              style={{
                background: 'rgba(255,255,255,0.05)',
                borderColor: badField === field.name ? '#c53030' : 'rgba(255,255,255,0.14)',
                color: '#ffffff',
              }}
            />
          </label>
        ))}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 w-full px-7 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {submitting ? 'TEXTING YOUR CODE...' : 'GET MY SDG PASS'}
        </button>
      </form>

      {error && (
        <p className="text-[12px] mt-3 text-center" style={{ color: '#ff8a8a' }} role="alert">
          {error}
        </p>
      )}

      <p className="text-[11px] mt-6 text-center leading-[1.6]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        We&apos;ll text you a 6-digit code to confirm your number. No spam, unsubscribe anytime.
      </p>
    </div>
  );
}
