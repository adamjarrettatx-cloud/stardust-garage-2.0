'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function ApplyForm({ planSlug, planName, planPrice }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoError, setPhotoError] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    preferred_name: '',
    email: '',
    phone: '',
    social_handle: '',
    website: '',
    birthday: '',
    why_stardust: '',
    how_did_you_hear: '',
    how_contribute: '',
    what_experiences: '',
    agreed_ethos: false,
    agreed_renewal: false,
    agreed_house_rules: false,
  });

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handlePhotoChange = (e) => {
    setPhotoError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError('Please choose a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('That photo is over 5MB. Please choose a smaller file.');
      return;
    }

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Check all required agreements
    if (!form.agreed_ethos || !form.agreed_renewal || !form.agreed_house_rules) {
      setError('Please check all three agreement boxes to continue.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    // If a photo was selected, upload it to storage first and get a public URL.
    let photoUrl = null;
    if (photoFile) {
      const ext = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const sanitized = photoFile.name
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .slice(0, 40) || 'photo';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitized}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('member-photos')
        .upload(filename, photoFile, { contentType: photoFile.type });

      if (uploadError) {
        setSubmitting(false);
        setError('Could not upload your photo. Please try again or submit without one.');
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from('member-photos')
        .getPublicUrl(filename);
      photoUrl = publicUrlData?.publicUrl || null;
    }

    const { error: insertError } = await supabase.from('membership_applications').insert({
      plan: planSlug,
      photo_url: photoUrl,
      full_name: form.full_name.trim(),
      preferred_name: form.preferred_name.trim() || null,
      email: form.email.trim(),
      phone: form.phone.trim(),
      social_handle: form.social_handle.trim(),
      website: form.website.trim() || null,
      birthday: form.birthday,
      why_stardust: form.why_stardust.trim(),
      how_did_you_hear: form.how_did_you_hear.trim(),
      how_contribute: form.how_contribute.trim(),
      what_experiences: form.what_experiences.trim(),
      agreed_ethos: form.agreed_ethos,
      agreed_renewal: form.agreed_renewal,
      agreed_house_rules: form.agreed_house_rules,
    });

    setSubmitting(false);

    if (insertError) {
      setError('Something went wrong. Please try again or contact us directly.');
      return;
    }

    // Fire-and-forget email notifications
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'membership_application',
        data: {
          plan: planSlug,
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          social_handle: form.social_handle.trim(),
          website: form.website.trim() || null,
          birthday: form.birthday,
          why_stardust: form.why_stardust.trim(),
          how_did_you_hear: form.how_did_you_hear.trim(),
          how_contribute: form.how_contribute.trim(),
          what_experiences: form.what_experiences.trim(),
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
          Application received
        </h1>
        <p className="text-[16px] leading-[1.6] mb-10" style={{ color: 'var(--text-3)' }}>
          Thanks for applying. We review every application personally and will be in touch soon with next steps.
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
    <main className="max-w-[700px] mx-auto px-4 md:px-6 py-12 md:py-16">
      <Link
        href="/members"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-3)' }}
      >
        ← BACK TO MEMBERSHIP
      </Link>

      <div className="text-center mb-12">
        <div
          className="inline-block text-[11px] font-semibold tracking-[0.2em] px-3.5 py-1.5 rounded-full mb-6"
          style={{
            color: 'var(--text-3)',
            border: '1px solid var(--fg-a12)',
          }}
        >
          {planName.toUpperCase()} · {planPrice}
        </div>
        <h1
          className="text-[36px] md:text-[52px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Membership
        </h1>
        <p className="text-[15px] italic" style={{ color: 'var(--text-3)' }}>
          Join the Constellation. Amplify the Frequency.
        </p>
        <p className="text-[12px] mt-4" style={{ color: 'var(--text-4)' }}>
          * indicates required
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div
          className="rounded-[14px] p-6 md:p-8 border space-y-6"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <div>
            <label className={labelClass} style={labelStyle}>FULL NAME *</label>
            <input
              type="text"
              required
              value={form.full_name}
              onChange={(e) => update('full_name', e.target.value)}
              placeholder="your full name"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>PREFERRED NAME / ALIAS</label>
            <input
              type="text"
              value={form.preferred_name}
              onChange={(e) => update('preferred_name', e.target.value)}
              placeholder="what we should call you"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>EMAIL ADDRESS *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="your@email.com"
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
              placeholder="your phone number"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>INSTAGRAM / SOCIAL MEDIA *</label>
            <input
              type="text"
              required
              value={form.social_handle}
              onChange={(e) => update('social_handle', e.target.value)}
              placeholder="@handle"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>WEBSITE / PORTFOLIO</label>
            <input
              type="text"
              value={form.website}
              onChange={(e) => update('website', e.target.value)}
              placeholder="yoursite.com"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>BIRTHDAY *</label>
            <input
              type="date"
              required
              value={form.birthday}
              onChange={(e) => update('birthday', e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>PROFILE PHOTO</label>
            <p className="text-[12px] leading-[1.5] mb-3" style={{ color: 'var(--text-3)' }}>
              Optional now, but required if your application is approved. JPG, PNG or WebP, max 5MB.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoChange}
              className="hidden"
            />
            <div className="flex items-center gap-4">
              {photoPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt="Profile preview"
                  className="w-[72px] h-[72px] flex-shrink-0 object-cover"
                  style={{ borderRadius: '14px', border: '1px solid var(--surface-5)' }}
                />
              )}
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-5 py-3 rounded-[10px] text-[12px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--fg-a15)', color: 'var(--text-1)' }}
                >
                  {photoFile ? 'CHANGE PHOTO' : 'CHOOSE PHOTO'}
                </button>
                {photoFile && (
                  <div className="text-[12px] mt-2 truncate" style={{ color: 'var(--text-3)' }}>
                    {photoFile.name}
                  </div>
                )}
              </div>
            </div>
            {photoError && (
              <div className="text-[12px] text-red-400 mt-2">{photoError}</div>
            )}
          </div>
        </div>

        <div
          className="rounded-[14px] p-6 md:p-8 border space-y-6"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <div>
            <label className={labelClass} style={labelStyle}>WHAT BRINGS YOU TO STARDUST? *</label>
            <textarea
              required
              rows={4}
              value={form.why_stardust}
              onChange={(e) => update('why_stardust', e.target.value)}
              placeholder="your answer"
              className={textareaClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>
              HOW DID YOU HEAR ABOUT OUR MEMBERSHIPS / WHO REFERRED YOU? *
            </label>
            <textarea
              required
              rows={3}
              value={form.how_did_you_hear}
              onChange={(e) => update('how_did_you_hear', e.target.value)}
              placeholder="your answer"
              className={textareaClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>HOW DO YOU WISH TO CONTRIBUTE TO THE COLLECTIVE? *</label>
            <textarea
              required
              rows={4}
              value={form.how_contribute}
              onChange={(e) => update('how_contribute', e.target.value)}
              placeholder="your answer"
              className={textareaClass}
              style={inputStyle}
            />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>WHAT KIND OF EXPERIENCES DO YOU MOST WANT TO SEE HERE? *</label>
            <textarea
              required
              rows={4}
              value={form.what_experiences}
              onChange={(e) => update('what_experiences', e.target.value)}
              placeholder="your answer"
              className={textareaClass}
              style={inputStyle}
            />
          </div>
        </div>

        <div
          className="rounded-[14px] p-6 md:p-8 border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--fg-a05)' }}
        >
          <h3 className={labelClass} style={{ ...labelStyle, marginBottom: 20 }}>
            CREATIVE ALIGNMENT *
          </h3>

          <label className="flex items-start gap-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.agreed_ethos}
              onChange={(e) => update('agreed_ethos', e.target.checked)}
              className="mt-0.5 w-4 h-4 flex-shrink-0 accent-white"
            />
            <span className="text-[14px] leading-[1.5]">
              I agree to uphold the Stardust ethos of respect, awareness, and co-creation.
            </span>
          </label>

          <label className="flex items-start gap-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.agreed_renewal}
              onChange={(e) => update('agreed_renewal', e.target.checked)}
              className="mt-0.5 w-4 h-4 flex-shrink-0 accent-white"
            />
            <span className="text-[14px] leading-[1.5]">
              I understand that membership renews monthly unless canceled.
            </span>
          </label>

          <label className="flex items-start gap-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.agreed_house_rules}
              onChange={(e) => update('agreed_house_rules', e.target.checked)}
              className="mt-0.5 w-4 h-4 flex-shrink-0 accent-white"
            />
            <span className="text-[14px] leading-[1.5]">
              I agree to follow all house rules, safety guidelines, and consent to culture practices.
            </span>
          </label>
        </div>

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
          {submitting ? 'SUBMITTING...' : 'REQUEST ACCESS'}
        </button>
      </form>
    </main>
  );
}
