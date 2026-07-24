'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const APPLYING_OPTIONS = ['Vendor', 'Artist', 'Performer', 'Other'];

export default function CollaborateForm({ role, roleLabel, roleSubtitle }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    company: '',
    instagram_handle: '',
    applying_for: '',
    experience: '',
    portfolio_link: '',
    additional_info: '',
  });

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.applying_for) {
      setError('Please select what you are applying / interested in.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { error: insertError } = await supabase.from('collaborations').insert({
      collaborator_type: role,
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim() || null,
      instagram_handle: form.instagram_handle.trim() || null,
      applying_for: form.applying_for,
      experience: form.experience.trim(),
      portfolio_link: form.portfolio_link.trim(),
      additional_info: form.additional_info.trim() || null,
    });

    setSubmitting(false);

    if (insertError) {
      setError('Something went wrong. Please try again or contact us directly at hello@sdgatx.com.');
      return;
    }

    // Fire-and-forget email notifications
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'collaboration',
        data: {
          collaborator_type: role,
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          company: form.company.trim() || null,
          instagram_handle: form.instagram_handle.trim() || null,
          applying_for: form.applying_for,
          experience: form.experience.trim(),
          portfolio_link: form.portfolio_link.trim(),
          additional_info: form.additional_info.trim() || null,
        },
        email: form.email.trim(),
      }),
    }).catch(() => {});

    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (submitted) {
    return (
      <main className="max-w-[700px] mx-auto px-4 md:px-6 py-20 md:py-24 text-center">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-8"
          style={{ background: 'var(--fg-a08)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1
          className="text-[32px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Submission received
        </h1>
        <p className="text-[16px] leading-[1.6] mb-10" style={{ color: 'var(--text-3)' }}>
          Thanks for reaching out. We review every submission personally and will be in touch soon.
        </p>
        <Link
          href="/"
          className="inline-block px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5"
          style={{ borderColor: 'var(--fg-a15)', color: 'var(--text-1)' }}
        >
          BACK TO HOME
        </Link>
      </main>
    );
  }

  const inputStyle = {
    background: 'var(--surface-1)',
    borderColor: 'var(--fg-a1)',
    color: 'var(--text-1)',
  };

  const labelClass = 'block text-[11px] font-semibold tracking-[0.16em] mb-2';
  const labelStyle = { color: 'var(--text-3)' };
  const inputClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const textareaClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30 resize-y';

  return (
    <main className="max-w-[780px] mx-auto px-4 md:px-6 py-12 md:py-16">
      <Link
        href="/"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK
      </Link>

      <div className="text-center mb-12">
        <div
          className="inline-block text-[11px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-6"
          style={{
            color: 'var(--text-3)',
            border: '1px solid var(--fg-a12)',
          }}
        >
          {roleLabel.toUpperCase()}
        </div>
        <h1
          className="text-[36px] md:text-[52px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Collaborate
        </h1>
        <p className="text-[15px] italic mb-2" style={{ color: 'var(--text-3)' }}>
          Let&apos;s create something together
        </p>
        <p className="text-[14px]" style={{ color: 'var(--text-3)' }}>
          {roleSubtitle}
        </p>
        <p className="text-[12px] mt-4" style={{ color: 'var(--text-4)' }}>
          * indicates required
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* CONTACT INFO */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: 'var(--text-3)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            CONTACT INFO
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>FULL NAME *</label>
              <input
                type="text"
                required
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                placeholder="Your full name"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>EMAIL ADDRESS *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>PHONE NUMBER *</label>
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>COMPANY / ORGANIZATION</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => update('company', e.target.value)}
                  placeholder="Optional"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>INSTAGRAM HANDLE</label>
                <input
                  type="text"
                  value={form.instagram_handle}
                  onChange={(e) => update('instagram_handle', e.target.value)}
                  placeholder="@yourhandle"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ABOUT YOU */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: 'var(--text-3)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            ABOUT YOU
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>WHAT ARE YOU APPLYING / INTERESTED IN? *</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {APPLYING_OPTIONS.map((opt) => {
                  const selected = form.applying_for === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => update('applying_for', opt)}
                      className="py-3 px-4 rounded-[10px] text-[13px] text-center border transition-all"
                      style={{
                        background: selected ? '#ffffff' : 'var(--surface-1)',
                        borderColor: selected ? '#ffffff' : 'rgba(255,255,255,0.1)',
                        color: selected ? '#0a0a0a' : 'var(--text-1)',
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>BRIEFLY DESCRIBE YOUR EXPERIENCE OR WHAT YOU OFFER *</label>
              <textarea
                required
                rows={5}
                value={form.experience}
                onChange={(e) => update('experience', e.target.value)}
                placeholder="Tell us about yourself and what you bring to the table..."
                className={textareaClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>PORTFOLIO / CONTENT SAMPLE *</label>
              <input
                type="text"
                required
                value={form.portfolio_link}
                onChange={(e) => update('portfolio_link', e.target.value)}
                placeholder="Link to your EKP, website, or content samples"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ANYTHING ELSE WE SHOULD KNOW?</label>
              <textarea
                rows={4}
                value={form.additional_info}
                onChange={(e) => update('additional_info', e.target.value)}
                placeholder="Optional — any additional info..."
                className={textareaClass}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="text-[13px] text-red-400 p-4 rounded-[10px] border border-red-500/30 bg-red-500/10">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-5 rounded-full text-[13px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {submitting ? 'SUBMITTING...' : 'SUBMIT'}
        </button>
      </form>
    </main>
  );
}
