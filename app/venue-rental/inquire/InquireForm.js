'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const AREA_OPTIONS = [
  'Main Room',
  'Back Patio',
  'Green Room',
  'Inside Bar',
  'Outside Bar',
  'VIP Sections',
  'Front of House',
];

export default function InquireForm({ inquiryType, typeLabel }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    company: '',
    website: '',
    event_name: '',
    event_type: '',
    preferred_dates: '',
    event_duration: '',
    expected_attendance: '',
    preferred_setup: '',
    areas_needed: [],
    production_elements: '',
    needs_setup_teardown: '',
    setup_teardown_details: '',
    event_vision: '',
    outside_vendors: '',
    special_requirements: '',
    budget_range: '',
    collaboration: '',
    how_did_you_hear: '',
    acknowledged_terms: false,
  });

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const toggleArea = (area) => {
    setForm((prev) => {
      const exists = prev.areas_needed.includes(area);
      return {
        ...prev,
        areas_needed: exists
          ? prev.areas_needed.filter((a) => a !== area)
          : [...prev.areas_needed, area],
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.acknowledged_terms) {
      setError('Please check the acknowledgment box to submit your inquiry.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { error: insertError } = await supabase.from('venue_inquiries').insert({
      inquiry_type: inquiryType || null,
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim() || null,
      website: form.website.trim(),
      event_name: form.event_name.trim(),
      event_type: form.event_type.trim(),
      preferred_dates: form.preferred_dates.trim(),
      event_duration: form.event_duration.trim(),
      expected_attendance: form.expected_attendance.trim(),
      preferred_setup: form.preferred_setup.trim(),
      areas_needed: form.areas_needed,
      production_elements: form.production_elements.trim() || null,
      needs_setup_teardown: form.needs_setup_teardown.trim(),
      setup_teardown_details: form.setup_teardown_details.trim() || null,
      event_vision: form.event_vision.trim(),
      outside_vendors: form.outside_vendors.trim(),
      special_requirements: form.special_requirements.trim() || null,
      budget_range: form.budget_range.trim(),
      collaboration: form.collaboration.trim(),
      how_did_you_hear: form.how_did_you_hear.trim(),
      acknowledged_terms: form.acknowledged_terms,
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
        formType: 'venue_inquiry',
        data: {
          inquiry_type: inquiryType || null,
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          company: form.company.trim() || null,
          event_name: form.event_name.trim(),
          event_type: form.event_type.trim(),
          preferred_dates: form.preferred_dates.trim(),
          expected_attendance: form.expected_attendance.trim(),
          areas_needed: form.areas_needed.join(', '),
          event_vision: form.event_vision.trim(),
          budget_range: form.budget_range.trim(),
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
          Inquiry received
        </h1>
        <p className="text-[16px] leading-[1.6] mb-10" style={{ color: 'var(--text-3)' }}>
          Thanks for reaching out about hosting your event at Stardust Garage. We&apos;ll review your inquiry and get back to you within 2-3 business days.
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
        href="/venue-rental"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK TO VENUE RENTAL
      </Link>

      <div className="text-center mb-12">
        {typeLabel && (
          <div
            className="inline-block text-[11px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-6"
            style={{
              color: 'var(--text-3)',
              border: '1px solid var(--fg-a12)',
            }}
          >
            {typeLabel.toUpperCase()}
          </div>
        )}
        <h1
          className="text-[36px] md:text-[52px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Venue Rental
        </h1>
        <p className="text-[15px] italic" style={{ color: 'var(--text-3)' }}>
          Inquire about hosting your event at Stardust Garage
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
              <label className={labelClass} style={labelStyle}>WEBSITE / SOCIAL LINK *</label>
              <input
                type="text"
                required
                value={form.website}
                onChange={(e) => update('website', e.target.value)}
                placeholder="instagram.com/yourhandle"
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {/* EVENT DETAILS */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: 'var(--text-3)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            EVENT DETAILS
          </h2>

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>EVENT NAME / TITLE *</label>
                <input
                  type="text"
                  required
                  value={form.event_name}
                  onChange={(e) => update('event_name', e.target.value)}
                  placeholder="Name of your event"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>EVENT TYPE *</label>
                <input
                  type="text"
                  required
                  value={form.event_type}
                  onChange={(e) => update('event_type', e.target.value)}
                  placeholder="Concert, Wedding, Party..."
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>PREFERRED EVENT DATE(S) *</label>
              <input
                type="text"
                required
                value={form.preferred_dates}
                onChange={(e) => update('preferred_dates', e.target.value)}
                placeholder="e.g. June 15, 2026 or flexible"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} style={labelStyle}>EVENT DURATION / HOURS OF USE *</label>
                <input
                  type="text"
                  required
                  value={form.event_duration}
                  onChange={(e) => update('event_duration', e.target.value)}
                  placeholder="e.g. 6 hours"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>EXPECTED ATTENDANCE *</label>
                <input
                  type="text"
                  required
                  value={form.expected_attendance}
                  onChange={(e) => update('expected_attendance', e.target.value)}
                  placeholder="e.g. 100-150 guests"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>PREFERRED SETUP *</label>
              <input
                type="text"
                required
                value={form.preferred_setup}
                onChange={(e) => update('preferred_setup', e.target.value)}
                placeholder="e.g. Concert, Banquet, Standing Room..."
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {/* SPACE & PRODUCTION */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: 'var(--text-3)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            SPACE &amp; PRODUCTION
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>WHICH AREAS DO YOU NEED? *</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                {AREA_OPTIONS.map((area) => {
                  const selected = form.areas_needed.includes(area);
                  return (
                    <button
                      key={area}
                      type="button"
                      onClick={() => toggleArea(area)}
                      className="py-3 px-4 rounded-[10px] text-[13px] text-left border transition-all"
                      style={{
                        background: selected ? '#ffffff' : 'var(--surface-1)',
                        borderColor: selected ? '#ffffff' : 'rgba(255,255,255,0.1)',
                        color: selected ? '#0a0a0a' : 'var(--text-1)',
                      }}
                    >
                      {area}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>WHAT PRODUCTION ELEMENTS WILL YOU NEED?</label>
              <textarea
                rows={4}
                value={form.production_elements}
                onChange={(e) => update('production_elements', e.target.value)}
                placeholder="Sound, lighting, AV, staging..."
                className={textareaClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>DO YOU NEED SETUP OR TEARDOWN TIME? *</label>
              <input
                type="text"
                required
                value={form.needs_setup_teardown}
                onChange={(e) => update('needs_setup_teardown', e.target.value)}
                placeholder="Yes / No"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>IF YES, PLEASE SPECIFY HOURS AND STAFF REQUESTS</label>
              <textarea
                rows={3}
                value={form.setup_teardown_details}
                onChange={(e) => update('setup_teardown_details', e.target.value)}
                placeholder="e.g. 2 hours setup, 1 hour teardown..."
                className={textareaClass}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {/* VISION & ADDITIONAL INFO */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: 'var(--text-3)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            VISION &amp; ADDITIONAL INFO
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>DESCRIBE YOUR VISION FOR THE EVENT *</label>
              <textarea
                required
                rows={5}
                value={form.event_vision}
                onChange={(e) => update('event_vision', e.target.value)}
                placeholder="Tell us about your event vision..."
                className={textareaClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ARE YOU BRINGING OUTSIDE VENDORS OR PRODUCTION TEAMS? *</label>
              <input
                type="text"
                required
                value={form.outside_vendors}
                onChange={(e) => update('outside_vendors', e.target.value)}
                placeholder="Yes / No — if yes, please describe"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ANY OTHER SPECIAL REQUIREMENTS OR NOTES?</label>
              <textarea
                rows={4}
                value={form.special_requirements}
                onChange={(e) => update('special_requirements', e.target.value)}
                placeholder="Anything else we should know..."
                className={textareaClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ESTIMATED BUDGET RANGE *</label>
              <input
                type="text"
                required
                value={form.budget_range}
                onChange={(e) => update('budget_range', e.target.value)}
                placeholder="e.g. $2,000 - $5,000"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ARE YOU LOOKING FOR COLLABORATION OR CO-PRODUCTION? *</label>
              <input
                type="text"
                required
                value={form.collaboration}
                onChange={(e) => update('collaboration', e.target.value)}
                placeholder="Yes / No — if yes, please describe"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>HOW DID YOU HEAR ABOUT STARDUST GARAGE? *</label>
              <input
                type="text"
                required
                value={form.how_did_you_hear}
                onChange={(e) => update('how_did_you_hear', e.target.value)}
                placeholder="Instagram, friend, Google..."
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        </section>

        {/* ACKNOWLEDGMENT */}
        <section
          className="rounded-[14px] p-5 md:p-6 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.acknowledged_terms}
              onChange={(e) => update('acknowledged_terms', e.target.checked)}
              className="mt-1 w-4 h-4 flex-shrink-0 accent-white"
            />
            <span className="text-[14px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
              By checking this box, and submitting this form, you acknowledge that Stardust Garage is an intentional, creative venue. All rentals are subject to management approval, availability and event alignment with our community values. <span style={{ color: 'var(--text-3)' }}>*</span>
            </span>
          </label>
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
          {submitting ? 'SUBMITTING...' : 'SUBMIT INQUIRY'}
        </button>
      </form>
    </main>
  );
}
