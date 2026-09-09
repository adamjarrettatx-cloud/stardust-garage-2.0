'use client';

// ProfilePhotoUploader.jsx
//
// Reusable client component for capturing / picking a profile photo and
// uploading it to /api/account/profile-photo. Consumed by:
//   - Wallet nudge modal (ticket confirmation + persistent banner)
//   - Trial-pass activation (hard requirement)
//   - Paid-membership application (hard requirement)
//   - /account/profile page (change photo)
//
// UX contract:
//   - Two-stage: user picks a file, we preview it locally, they confirm.
//     Prevents "oops wrong photo committed" and gives them a chance to
//     retake if the front-camera shot is bad.
//   - Client-side validation for size + mime before uploading (server
//     re-validates authoritatively — client is only there to spare wasted
//     bandwidth and give faster feedback).
//   - Front camera by default on mobile (capture="user") so the "take a
//     selfie now" flow is one tap. Users can still pick from library.
//   - onUploaded(result) fires after a successful upload with the fresh
//     signed URL so parent surfaces (wallet nudge, trial-pass form) can
//     update their own UI without a page refresh.

import { useEffect, useRef, useState } from 'react';
import ProfileAvatar from './ProfileAvatar';

const MAX_MB = 5;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const ACCEPTED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

// Default uploader: POST multipart to /api/account/profile-photo with the
// caller's Supabase bearer token. Consumers can override `uploadFn` to
// swap in a different endpoint (e.g. trial-pass token-authenticated upload).
async function defaultAccountUpload(file) {
  // Lazy import so this component can be used without a Supabase client
  // available (e.g. in the trial-pass token flow which uses `uploadFn`).
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Your session expired. Please sign in again.');
  const form = new FormData();
  form.append('photo', file, file.name);
  const res = await fetch('/api/account/profile-photo', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Upload failed (${res.status}).`);
  return { signedUrl: json.signedUrl || null, uploadedAt: json.uploadedAt || null };
}

export default function ProfilePhotoUploader({
  currentSignedUrl = null,
  nameOrEmail = '',
  variant = 'inline',      // 'inline' | 'modal-body'
  ctaLabel = 'UPLOAD PHOTO',
  helperText = 'One clear photo of your face. Door staff sees this next to your ticket at check-in.',
  uploadFn,                // async (file) => { signedUrl, uploadedAt }
  onUploaded,              // (result: { signedUrl, uploadedAt }) => void
  onError,                 // (message: string) => void
}) {
  const [pickedFile, setPickedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [displayedSignedUrl, setDisplayedSignedUrl] = useState(currentSignedUrl);
  const [status, setStatus] = useState('idle');   // idle | uploading | done | error
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);

  // Sync when the parent hands us a new signed URL (e.g. after a page revalidation).
  useEffect(() => {
    setDisplayedSignedUrl(currentSignedUrl);
  }, [currentSignedUrl]);

  // Free the object URL when we replace or unmount to avoid leaks.
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function openPicker() {
    inputRef.current?.click();
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage('');
    setStatus('idle');

    if (!ACCEPTED_MIME.includes(file.type)) {
      const msg = `That file isn't a supported image. Use JPEG, PNG, WebP, or HEIC.`;
      setStatus('error');
      setMessage(msg);
      onError?.(msg);
      return;
    }
    if (file.size > MAX_BYTES) {
      const msg = `Photo is over ${MAX_MB} MB. Please choose a smaller file.`;
      setStatus('error');
      setMessage(msg);
      onError?.(msg);
      return;
    }
    if (file.size < 1024) {
      const msg = `Photo looks empty. Try again.`;
      setStatus('error');
      setMessage(msg);
      onError?.(msg);
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPickedFile(file);
  }

  function discardPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPickedFile(null);
    setStatus('idle');
    setMessage('');
    if (inputRef.current) inputRef.current.value = '';
  }

  async function confirmUpload() {
    if (!pickedFile) return;
    setStatus('uploading');
    setMessage('');
    try {
      const result = uploadFn
        ? await uploadFn(pickedFile)
        : await defaultAccountUpload(pickedFile);
      setStatus('done');
      setMessage('Photo saved.');
      setDisplayedSignedUrl(result?.signedUrl || null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPickedFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.({ signedUrl: result?.signedUrl || null, uploadedAt: result?.uploadedAt || null });
    } catch (err) {
      const msg = err?.message || 'Upload failed. Please try again.';
      setStatus('error');
      setMessage(msg);
      onError?.(msg);
    }
  }

  const showingPreview = !!previewUrl;
  const uploading = status === 'uploading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {showingPreview ? (
          <ProfileAvatar src={previewUrl} nameOrEmail={nameOrEmail} size={72} ring />
        ) : (
          <ProfileAvatar src={displayedSignedUrl} nameOrEmail={nameOrEmail} size={72} ring />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: '#8a8a8a',
              lineHeight: 1.5,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            {showingPreview ? 'Preview — confirm to upload' : helperText}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MIME.join(',')}
        capture="user"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      {!showingPreview && (
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          style={btnStyle({ primary: true, disabled: uploading })}
        >
          {displayedSignedUrl ? 'REPLACE PHOTO' : ctaLabel}
        </button>
      )}

      {showingPreview && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={confirmUpload}
            disabled={uploading}
            style={{ ...btnStyle({ primary: true, disabled: uploading }), flex: 2 }}
          >
            {uploading ? 'UPLOADING…' : 'USE THIS PHOTO'}
          </button>
          <button
            type="button"
            onClick={discardPreview}
            disabled={uploading}
            style={{ ...btnStyle({ primary: false, disabled: uploading }), flex: 1 }}
          >
            RETAKE
          </button>
        </div>
      )}

      {message && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: status === 'error' ? '#ff8686' : '#d9c48c',
          }}
          role={status === 'error' ? 'alert' : 'status'}
        >
          {message}
        </div>
      )}
    </div>
  );
}

function btnStyle({ primary, disabled }) {
  const opacity = disabled ? 0.55 : 1;
  if (primary) {
    return {
      appearance: 'none',
      border: 'none',
      background: '#f5f5f5',
      color: '#0a0a0a',
      padding: '12px 16px',
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: '0.08em',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity,
      textTransform: 'uppercase',
      borderRadius: 2,
    };
  }
  return {
    appearance: 'none',
    background: 'transparent',
    color: '#e0e0e0',
    padding: '12px 16px',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.08em',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity,
    textTransform: 'uppercase',
    borderRadius: 2,
    border: '1px solid rgba(255,255,255,0.25)',
  };
}
