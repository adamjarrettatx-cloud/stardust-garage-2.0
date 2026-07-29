'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Wordmark from '@/app/components/Wordmark';
import PartnerSignIn from '../PartnerSignIn';
import PartnerSignOutButton from '../PartnerSignOutButton';
import { uploadPartnerPhoto, validatePhotoFile } from '@/lib/partner-photo';

export default function ActivateClient() {
  const router = useRouter();

  // null = still resolving the session, then the partner_profiles row or false
  // when the signed-in account isn't tied to an invite.
  const [profile, setProfile] = useState(null);
  const [resolved, setResolved] = useState(false);
  // Distinguishes "no session at all" (offer the sign-in buttons) from "signed
  // in as somebody we don't recognise" (a dead end that needs explaining).
  const [signedIn, setSignedIn] = useState(false);

  const [fullName, setFullName] = useState('');
  const fileInputRef = useRef(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Two ways in land here. The invite email links straight to this page with
  // ?token_hash=, which we redeem below — see buildPartnerActivationUrl for why
  // the link comes to us instead of going through Supabase's redirect. Google
  // sign-in arrives already authenticated, redirected on by
  // /partner/auth/callback. Either way, by the time this resolves there is a
  // session or there isn't.
  useEffect(() => {
    const load = async () => {
      const supabase = createClient();

      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      if (tokenHash) {
        await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
        // Single-use token: keep it out of the address bar so a refresh or a
        // shared URL doesn't look like an expired link.
        window.history.replaceState(null, '', window.location.pathname);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setResolved(true);
        return;
      }
      setSignedIn(true);

      // Resolved server-side rather than by reading partner_profiles directly:
      // the row is matched on the invited email and re-pointed at this session's
      // identity if it belonged to the other one. A partner who signed in with
      // Google once and clicks an emailed link later is authenticating as a
      // different auth user, and this is what keeps that from looking like an
      // expired link. See /api/partner/resolve-identity.
      const res = await fetch('/api/partner/resolve-identity', { method: 'POST' });
      const data = await res.json().catch(() => null);
      const row = res.ok ? data?.profile : null;

      setProfile(row || false);
      setFullName(row?.full_name || session.user.user_metadata?.full_name || '');
      setResolved(true);
    };
    load();
  }, []);

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

    if (!fullName.trim()) {
      setError('Please enter your name.');
      return;
    }
    // The photo is not optional here, matching the gate approve-member enforces
    // for members: no photo, no active profile.
    if (!photoFile) {
      setPhotoError('A profile photo is required.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const upload = await uploadPartnerPhoto(supabase, photoFile);
    if (upload.error) {
      setSubmitting(false);
      setError(upload.error);
      return;
    }

    const res = await fetch('/api/partner/complete-activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: fullName.trim(),
        photoUrl: upload.url,
      }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      setSubmitting(false);
      setError(data?.error || 'Could not finish setting up your profile.');
      return;
    }

    router.push('/partner/profile');
    router.refresh();
  };

  const shell = (children) => (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[440px]">
        <div className="flex justify-center mb-10">
          <Wordmark size="md" align="center" />
        </div>
        {children}
      </div>
    </main>
  );

  if (!resolved) {
    return shell(
      <p className="text-[14px] text-center" style={{ color: '#8a8a8a' }}>
        Loading...
      </p>
    );
  }

  // Signed in, but the account behind the session matches no invite. Almost
  // always a partner who picked the wrong Google account, so name the way out
  // rather than just refusing.
  if (!profile && signedIn) {
    return shell(
      <div className="text-center">
        <h1
          className="text-[24px] font-extrabold -tracking-[0.02em] mb-4 leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          This account isn&apos;t linked to an invite.
        </h1>
        <p className="text-[14px] leading-[1.6] mb-8" style={{ color: '#a0a0a0' }}>
          We couldn&apos;t find a Stardust Garage partner invite for the account you signed in
          with. Sign out and try the address we invited, or contact SDG and we&apos;ll send a new
          invite.
        </p>
        <PartnerSignOutButton />
      </div>
    );
  }

  // No session: the invite link has been used or has expired. Both doors are
  // offered here so the invitee can let themselves back in instead of having to
  // ask us for another link.
  if (!profile) {
    return shell(
      <>
        <div className="text-[11px] font-semibold tracking-[0.28em] mb-4 text-center" style={{ color: '#a0a0a0' }}>
          PARTNER SETUP
        </div>
        <h1
          className="text-[24px] font-extrabold -tracking-[0.02em] mb-2 text-center leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Sign in to finish setting up.
        </h1>
        <p className="text-[13px] leading-[1.6] text-center mb-10" style={{ color: '#8a8a8a' }}>
          Invite links are single-use and expire. Use the Google account on the email we invited,
          or have us send a fresh link.
        </p>

        <PartnerSignIn />

        <div className="text-center mt-10">
          <Link
            href="/"
            className="text-[12px] underline hover:text-white transition-colors"
            style={{ color: '#a0a0a0' }}
          >
            Back to the site
          </Link>
        </div>
      </>
    );
  }

  if (profile.is_active) {
    return shell(
      <div className="text-center">
        <div className="text-[11px] font-semibold tracking-[0.28em] mb-4" style={{ color: '#a0a0a0' }}>
          ALREADY ACTIVE
        </div>
        <h1
          className="text-[26px] font-extrabold -tracking-[0.02em] mb-4 leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          You&apos;re all set.
        </h1>
        <Link
          href="/partner/profile"
          className="inline-block px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          GO TO MY PROFILE
        </Link>
      </div>
    );
  }

  return shell(
    <>
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-4 text-center" style={{ color: '#a0a0a0' }}>
        PARTNER SETUP
      </div>
      <h1
        className="text-[28px] font-extrabold -tracking-[0.02em] mb-2 text-center leading-[1.1]"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Create your profile.
      </h1>
      <p className="text-[13px] text-center mb-10" style={{ color: '#8a8a8a' }}>
        Confirm your name and add a photo so our door staff know who you are.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
            FULL NAME
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
            style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }}
          />
        </div>

        <div>
          <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
            PROFILE PHOTO *
          </label>
          <p className="text-[12px] leading-[1.5] mb-3" style={{ color: '#8a8a8a' }}>
            Required. JPG, PNG or WebP, max 5MB.
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
                style={{ borderRadius: '14px', border: '1px solid #2a2a2a' }}
              />
            )}
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-5 py-3 rounded-[10px] text-[12px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
                style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
              >
                {photoFile ? 'CHANGE PHOTO' : 'CHOOSE PHOTO'}
              </button>
              {photoFile && (
                <div className="text-[12px] mt-2 truncate" style={{ color: '#8a8a8a' }}>
                  {photoFile.name}
                </div>
              )}
            </div>
          </div>
          {photoError && <div className="text-[12px] text-red-400 mt-2">{photoError}</div>}
        </div>

        {error && <div className="text-[13px] text-red-400 text-center">{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          {submitting ? 'SAVING...' : 'CREATE MY PROFILE'}
        </button>
      </form>
    </>
  );
}
