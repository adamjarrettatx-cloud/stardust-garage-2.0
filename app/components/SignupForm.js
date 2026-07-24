'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function detectContactType(value) {
  const trimmed = value.trim();
  if (/@/.test(trimmed) && /\./.test(trimmed)) return 'email';
  if (/\d{7,}/.test(trimmed.replace(/\D/g, ''))) return 'phone';
  return 'other';
}

export default function SignupForm() {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setError('');
    setSubmitting(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from('signups').insert({
      contact: trimmed,
      contact_type: detectContactType(trimmed),
      source: 'homepage',
    });

    setSubmitting(false);

    if (insertError) {
      setError('Something went wrong. Please try again.');
      return;
    }

    // Fire-and-forget email notifications. We don't await this — if
    // Resend has an issue, the user still sees their success state.
    const contactType = detectContactType(trimmed);
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'signup',
        data: { contact: trimmed, contact_type: contactType, source: 'homepage' },
        email: contactType === 'email' ? trimmed : null,
      }),
    }).catch(() => {});

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="max-w-[520px] mx-auto text-center">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-6"
          style={{ background: 'rgba(0,0,0,0.08)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3
          className="text-[26px] font-bold mb-3 -tracking-[0.01em]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          You&apos;re on the list
        </h3>
        <p className="text-[15px] leading-[1.6]" style={{ color: 'var(--text-4)' }}>
          We&apos;ll be in touch with the next drop.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[520px] mx-auto text-center">
      <div
        className="inline-block text-[11px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-6"
        style={{
          color: 'var(--text-4)',
          border: '1px solid rgba(0,0,0,0.15)',
        }}
      >
        STAY IN THE LOOP
      </div>
      <h2
        className="text-[32px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-4"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Never miss a drop.
      </h2>
      <p className="text-[15px] leading-[1.55] mb-8 max-w-[420px] mx-auto" style={{ color: 'var(--text-4)' }}>
        Get early access to events, parties, and members-only experiences.
      </p>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col sm:flex-row gap-2.5 max-w-[460px] mx-auto"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Email or phone number"
          required
          className="flex-1 px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-black/40"
          style={{
            background: '#ffffff',
            borderColor: 'rgba(0,0,0,0.15)',
            color: '#0a0a0a',
          }}
        />
        <button
          type="submit"
          disabled={submitting}
          className="px-7 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 whitespace-nowrap disabled:opacity-50"
          style={{ background: '#0a0a0a', color: '#ffffff' }}
        >
          {submitting ? 'SUBMITTING...' : 'NOTIFY ME'}
        </button>
      </form>
      {error && (
        <p className="text-[12px] mt-3" style={{ color: 'var(--st-c53030)' }}>{error}</p>
      )}
      <p className="text-[11px] mt-4" style={{ color: 'var(--text-4)' }}>
        No spam. Unsubscribe anytime.
      </p>
    </div>
  );
}
