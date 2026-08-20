'use client';

import { useMemo, useState } from 'react';
import { qrMatrixToSvg } from '@/lib/qr-code';

// The three-question intake form behind the printed QR codes in the venue, and
// the success state it turns into.
//
// One component, two states, no navigation between them: the guest is standing
// up, probably holding a drink, on venue wifi. A redirect to a /success route
// is one more thing that can spin. The pass URL comes back in the POST
// response, the QR is drawn from it locally, and the code is on screen before
// the confirmation email has left Resend.
//
// The token is never written to localStorage or a cookie. It lives in this
// component's state for as long as the page is open, and in the guest's email
// forever — which is why the email is sent on the same request.

const FIELDS = [
  { name: 'fullName', label: 'Full legal name', type: 'text', autoComplete: 'name', placeholder: 'Jane Doe' },
  { name: 'phone', label: 'Mobile phone number', type: 'tel', autoComplete: 'tel', placeholder: '(512) 555-0134' },
  { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email', placeholder: 'you@email.com' },
];

export default function TrialPassForm() {
  const [values, setValues] = useState({ fullName: '', phone: '', email: '' });
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    setError('');
    setBadField(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/trial-pass/create', {
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
      setPass(body);
    } catch {
      setError('No connection. Check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (pass) {
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
          // The encoder returns null rather than an unscannable code if the
          // payload will not fit; the link still works, so show that instead of
          // a blank square.
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

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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
          {submitting ? 'CREATING YOUR PASS...' : 'GET MY SDG PASS'}
        </button>
      </form>

      {error && (
        <p className="text-[12px] mt-3 text-center" style={{ color: '#ff8a8a' }} role="alert">
          {error}
        </p>
      )}

      <p className="text-[11px] mt-6 text-center leading-[1.6]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        We use your number and email to send your pass and event access. No spam, unsubscribe anytime.
      </p>
    </div>
  );
}
