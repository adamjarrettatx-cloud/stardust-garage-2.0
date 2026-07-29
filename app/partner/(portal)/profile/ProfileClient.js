'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { uploadPartnerPhoto, validatePhotoFile } from '@/lib/partner-photo';

function partnerSince(invitedAt) {
  if (!invitedAt) return null;
  const date = new Date(invitedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ProfileClient({ email, contactTypes, profile }) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  // What is currently on the record, as opposed to what is in the form. Kept in
  // state so a successful save updates the page without a round trip, and so
  // Cancel has something to put back.
  const [current, setCurrent] = useState(profile);

  const [fullName, setFullName] = useState(profile.fullName);
  const fileInputRef = useRef(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const since = partnerSince(current.invitedAt);
  const shownPhoto = photoPreview || current.photoUrl;

  const startEditing = () => {
    setFullName(current.fullName);
    setPhotoFile(null);
    setPhotoPreview('');
    setPhotoError('');
    setError('');
    setSaved(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview('');
    setPhotoFile(null);
    setEditing(false);
  };

  const handlePhotoChange = (e) => {
    setPhotoError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const invalid = validatePhotoFile(file);
    if (invalid) {
      setPhotoError(invalid);
      return;
    }

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const name = fullName.trim();
    if (!name) {
      setError('Please enter your name.');
      return;
    }

    setSaving(true);
    const supabase = createClient();

    // Only sent when they picked a new one — an omitted photoUrl leaves the
    // existing photo alone, and the route rejects an empty one outright. The
    // photo stays mandatory after activation, it just can't be cleared here.
    let photoUrl;
    if (photoFile) {
      const upload = await uploadPartnerPhoto(supabase, photoFile);
      if (upload.error) {
        setSaving(false);
        setPhotoError(upload.error);
        return;
      }
      photoUrl = upload.url;
    }

    const res = await fetch('/api/partner/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(photoUrl ? { fullName: name, photoUrl } : { fullName: name }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);

    if (!res.ok) {
      setError(data?.error || 'Could not save your profile.');
      return;
    }

    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setCurrent((prev) => ({ ...prev, fullName: name, photoUrl: photoUrl || prev.photoUrl }));
    setPhotoFile(null);
    setPhotoPreview('');
    setEditing(false);
    setSaved(true);
    // The nav and any other server-rendered read of partner_self() should agree
    // with what was just saved.
    router.refresh();
  };

  return (
    <main className="max-w-[720px] mx-auto px-5 sm:px-6 py-10 sm:py-14">
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
        MY PROFILE
      </div>
      <h1
        className="text-[30px] sm:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-8"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {current.fullName || current.contactDisplayName}
      </h1>

      <div
        className="rounded-[16px] border p-6 sm:p-7"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-start gap-5 sm:gap-6">
          {shownPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shownPhoto}
              alt={current.fullName || 'Partner photo'}
              className="w-[88px] h-[88px] sm:w-[96px] sm:h-[96px] flex-shrink-0 object-cover"
              style={{ borderRadius: '16px', border: '1px solid #2a2a2a' }}
            />
          ) : (
            <div
              className="w-[88px] h-[88px] sm:w-[96px] sm:h-[96px] flex-shrink-0 flex items-center justify-center text-[11px] font-semibold tracking-[0.12em]"
              style={{ borderRadius: '16px', border: '1px solid #2a2a2a', color: '#555' }}
            >
              NO PHOTO
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div
              className="text-[18px] sm:text-[20px] font-bold mb-2 break-words"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {current.contactDisplayName}
            </div>
            {contactTypes.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {contactTypes.map((label) => (
                  <span
                    key={label}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-[0.12em]"
                    style={{ background: 'rgba(255,255,255,0.06)', color: '#a0a0a0' }}
                  >
                    {label.toUpperCase()}
                  </span>
                ))}
              </div>
            )}
            {since && (
              <div className="text-[12px]" style={{ color: '#8a8a8a' }}>
                Partner since {since}
              </div>
            )}
          </div>
        </div>

        {editing ? (
          <form onSubmit={handleSubmit} className="mt-7 pt-7 space-y-6" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div>
              <label
                htmlFor="partner-full-name"
                className="block text-[12px] font-semibold tracking-[0.14em] mb-2"
                style={{ color: '#8a8a8a' }}
              >
                YOUR NAME
              </label>
              <input
                id="partner-full-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
                className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
                style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }}
              />
            </div>

            <div>
              <div className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
                PROFILE PHOTO
              </div>
              <p className="text-[12px] leading-[1.5] mb-3" style={{ color: '#8a8a8a' }}>
                Our door staff use this to recognise you. JPG, PNG or WebP, max 5MB.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-5 py-3 rounded-[10px] text-[12px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
                style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
              >
                {photoFile ? 'CHOOSE A DIFFERENT PHOTO' : 'REPLACE PHOTO'}
              </button>
              {photoFile && (
                <div className="text-[12px] mt-2 truncate" style={{ color: '#8a8a8a' }}>
                  {photoFile.name}
                </div>
              )}
              {photoError && <div className="text-[12px] text-red-400 mt-2">{photoError}</div>}
            </div>

            {error && <div className="text-[13px] text-red-400">{error}</div>}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-7 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
                style={{ background: '#ffffff', color: '#0a0a0a' }}
              >
                {saving ? 'SAVING...' : 'SAVE CHANGES'}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saving}
                className="px-7 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
              >
                CANCEL
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-7 pt-7 flex flex-wrap items-center gap-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              onClick={startEditing}
              className="px-7 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
              style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
            >
              EDIT NAME &amp; PHOTO
            </button>
            {saved && (
              <span className="text-[12px]" style={{ color: '#7ac68b' }}>
                Saved.
              </span>
            )}
          </div>
        )}
      </div>

      <p className="mt-8 text-[13px] leading-[1.6]" style={{ color: '#8a8a8a' }}>
        Signed in as <span style={{ color: '#f5f5f5' }}>{email}</span>. To change your
        organization&apos;s name or the details we have on file, email{' '}
        <a href="mailto:info@sdgatx.com" style={{ color: '#f5f5f5' }}>
          info@sdgatx.com
        </a>
        .
      </p>
    </main>
  );
}
