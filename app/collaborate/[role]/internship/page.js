'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const AREA_OPTIONS = [
  'Live music & event production',
  'Event setup & breakdown',
  'Venue operations',
  'Floor / event management',
  'Guest experience',
  'Artist hospitality',
  'Audio / lighting / production',
  'Marketing & promotion',
  'Other',
];

const AVAILABILITY_OPTIONS = [
  'Weekdays',
  'Weekday evenings',
  'Friday nights',
  'Saturday nights',
  'Sundays',
  'Late nights',
];

export default function InternshipPage() {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    is_18_plus: '',
    enrolled_school: '',
    school_program: '',
    why_interested: '',
    areas_of_interest: [],
    has_experience: '',
    experience_description: '',
    availability: [],
    about_yourself: '',
  });

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const toggleMulti = (field, value) => {
    setForm((prev) => {
      const current = prev[field];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [field]: next };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.is_18_plus) {
      setError('Please let us know if you are 18 or older.');
      return;
    }
    if (!form.enrolled_school) {
      setError('Please let us know if you are currently enrolled in school or an educational program.');
      return;
    }
    if (form.enrolled_school === 'Yes' && !form.school_program.trim()) {
      setError('Please tell us your school/program and area of study.');
      return;
    }
    if (form.areas_of_interest.length === 0) {
      setError('Please select at least one area you are interested in learning about.');
      return;
    }
    if (!form.has_experience) {
      setError('Please let us know if you have any previous relevant experience.');
      return;
    }
    if (form.has_experience === 'Yes' && !form.experience_description.trim()) {
      setError('Please briefly describe your experience.');
      return;
    }
    if (form.availability.length === 0) {
      setError('Please select your general availability.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const additionalInfo = [
      `18 or older: ${form.is_18_plus}`,
      `Currently enrolled in school/program: ${form.enrolled_school}`,
      `Why interested in interning with us: ${form.why_interested.trim() || 'N/A'}`,
      `Availability: ${form.availability.join(', ')}`,
      `About them / what they hope to get out of it: ${form.about_yourself.trim() || 'N/A'}`,
    ].join('\n');

    const { error: insertError } = await supabase.from('collaborations').insert({
      collaborator_type: 'internship',
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.enrolled_school === 'Yes' ? form.school_program.trim() : null,
      instagram_handle: null,
      applying_for: form.areas_of_interest.join(', '),
      experience:
        form.has_experience === 'Yes'
          ? form.experience_description.trim()
          : 'No experience yet',
      portfolio_link: '',
      additional_info: additionalInfo,
    });

    setSubmitting(false);

    if (insertError) {
      setError('Something went wrong. Please try again or contact us directly at hello@sdgatx.com.');
      return;
    }

    // Fire-and-forget email notifications — send the full, granular
    // breakdown here even though the DB row above compresses some of
    // it into additional_info, so the internal notification email
    // shows every answer clearly.
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'collaboration',
        data: {
          collaborator_type: 'internship',
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          is_18_plus: form.is_18_plus,
          enrolled_school: form.enrolled_school,
          school_program: form.enrolled_school === 'Yes' ? form.school_program.trim() : null,
          why_interested: form.why_interested.trim(),
          areas_of_interest: form.areas_of_interest.join(', '),
          has_experience: form.has_experience,
          experience_description:
            form.has_experience === 'Yes' ? form.experience_description.trim() : 'No experience yet',
          availability: form.availability.join(', '),
          about_yourself: form.about_yourself.trim(),
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
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f5f5f5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1
          className="text-[32px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Application received
        </h1>
        <p className="text-[16px] leading-[1.6] mb-10" style={{ color: '#8a8a8a' }}>
          Thanks for applying to intern with Stardust Garage. We review every submission
          personally and will be in touch soon.
        </p>
        <Link
          href="/"
          className="inline-block px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5"
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          BACK TO HOME
        </Link>
      </main>
    );
  }

  const inputStyle = {
    background: '#141414',
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#f5f5f5',
  };

  const labelClass = 'block text-[11px] font-semibold tracking-[0.16em] mb-2';
  const labelStyle = { color: '#a0a0a0' };
  const inputClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const textareaClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30 resize-y';

  const pillButton = (selected) => ({
    background: selected ? '#ffffff' : '#141414',
    borderColor: selected ? '#ffffff' : 'rgba(255,255,255,0.1)',
    color: selected ? '#0a0a0a' : '#f5f5f5',
  });

  return (
    <main className="max-w-[780px] mx-auto px-4 md:px-6 py-12 md:py-16">
      <Link
        href="/"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK
      </Link>

      <div className="text-center mb-12">
        <div
          className="inline-block text-[11px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-6"
          style={{
            color: '#8a8a8a',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          INTERNSHIP
        </div>
        <h1
          className="text-[36px] md:text-[52px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Collaborate
        </h1>
        <p className="text-[15px] italic mb-2" style={{ color: '#a0a0a0' }}>
          Learn the venue from the inside
        </p>
        <p className="text-[14px] max-w-[560px] mx-auto" style={{ color: '#8a8a8a' }}>
          Hands-on experience in venue management, event coordination, and how our
          membership program runs — start to finish.
        </p>
        <p className="text-[12px] mt-4" style={{ color: '#666' }}>
          * indicates required
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* CONTACT INFO */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: '#8a8a8a', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
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
          </div>
        </section>

        {/* ELIGIBILITY */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: '#8a8a8a', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            ELIGIBILITY
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>ARE YOU 18 YEARS OF AGE OR OLDER? *</label>
              <div className="grid grid-cols-2 gap-2.5">
                {['Yes', 'No'].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => update('is_18_plus', opt)}
                    className="py-3 px-4 rounded-[10px] text-[13px] text-center border transition-all"
                    style={pillButton(form.is_18_plus === opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>ARE YOU CURRENTLY ENROLLED IN SCHOOL OR AN EDUCATIONAL PROGRAM? *</label>
              <div className="grid grid-cols-2 gap-2.5">
                {['Yes', 'No'].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => update('enrolled_school', opt)}
                    className="py-3 px-4 rounded-[10px] text-[13px] text-center border transition-all"
                    style={pillButton(form.enrolled_school === opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {form.enrolled_school === 'Yes' && (
              <div>
                <label className={labelClass} style={labelStyle}>SCHOOL/PROGRAM AND AREA OF STUDY *</label>
                <input
                  type="text"
                  required
                  value={form.school_program}
                  onChange={(e) => update('school_program', e.target.value)}
                  placeholder="e.g. UT Austin, Music Business"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            )}
          </div>
        </section>

        {/* ABOUT YOU */}
        <section
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <h2 className="text-[11px] font-semibold tracking-[0.16em] mb-6" style={{ color: '#8a8a8a', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            ABOUT YOU
          </h2>

          <div className="space-y-5">
            <div>
              <label className={labelClass} style={labelStyle}>WHY ARE YOU INTERESTED IN INTERNING WITH US? *</label>
              <textarea
                required
                rows={4}
                value={form.why_interested}
                onChange={(e) => update('why_interested', e.target.value)}
                placeholder="Tell us what draws you to this internship..."
                className={textareaClass}
                style={inputStyle}
              />
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>WHAT AREAS ARE YOU MOST INTERESTED IN LEARNING ABOUT? (SELECT ALL THAT APPLY) *</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                {AREA_OPTIONS.map((opt) => {
                  const selected = form.areas_of_interest.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleMulti('areas_of_interest', opt)}
                      className="py-3 px-3 rounded-[10px] text-[12.5px] text-center border transition-all leading-tight"
                      style={pillButton(selected)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>
                DO YOU HAVE ANY PREVIOUS EXPERIENCE WITH EVENTS, MUSIC VENUES, HOSPITALITY, NIGHTLIFE, PRODUCTION, OR CUSTOMER SERVICE? *
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {[
                  { value: 'Yes', label: 'Yes — briefly describe' },
                  { value: 'No', label: 'No experience yet' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update('has_experience', opt.value)}
                    className="py-3 px-4 rounded-[10px] text-[13px] text-center border transition-all"
                    style={pillButton(form.has_experience === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {form.has_experience === 'Yes' && (
              <div>
                <label className={labelClass} style={labelStyle}>BRIEFLY DESCRIBE YOUR EXPERIENCE *</label>
                <textarea
                  required
                  rows={3}
                  value={form.experience_description}
                  onChange={(e) => update('experience_description', e.target.value)}
                  placeholder="Tell us about your relevant experience..."
                  className={textareaClass}
                  style={inputStyle}
                />
              </div>
            )}

            <div>
              <label className={labelClass} style={labelStyle}>WHAT IS YOUR GENERAL AVAILABILITY? (SELECT ALL THAT APPLY) *</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                {AVAILABILITY_OPTIONS.map((opt) => {
                  const selected = form.availability.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggleMulti('availability', opt)}
                      className="py-3 px-3 rounded-[10px] text-[12.5px] text-center border transition-all leading-tight"
                      style={pillButton(selected)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>TELL US A LITTLE ABOUT YOURSELF AND WHAT YOU HOPE TO GET OUT OF THIS INTERNSHIP. *</label>
              <textarea
                required
                rows={5}
                value={form.about_yourself}
                onChange={(e) => update('about_yourself', e.target.value)}
                placeholder="A bit about you, your goals, and what you're hoping to learn..."
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
