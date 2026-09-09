'use client';

// PhotoBlock.jsx
//
// Client wrapper shown on /pass/[token] beneath the QR. Two states:
//   - Photo on file  → small confirmation strip with the avatar
//   - No photo       → prominent warning + inline uploader (token-authed)
//
// The pass token is passed in as a prop so the uploader can POST to
// /api/trial-pass/photo without any Supabase session. Same auth model as
// the pass page itself: whoever has the token can operate on the pass.

import { useState } from 'react';
import ProfilePhotoUploader from '@/components/profile-photo/ProfilePhotoUploader';
import ProfileAvatar from '@/components/profile-photo/ProfileAvatar';

export default function PhotoBlock({ token, initialSignedUrl, nameOrDisplay }) {
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl || null);
  const [showUploader, setShowUploader] = useState(!initialSignedUrl);

  const uploadFn = async (file) => {
    const form = new FormData();
    form.append('photo', file, file.name);
    form.append('token', token);
    const res = await fetch('/api/trial-pass/photo', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Upload failed (${res.status}).`);
    return { signedUrl: json.signedUrl || null, uploadedAt: json.uploadedAt || null };
  };

  if (signedUrl && !showUploader) {
    return (
      <div
        className="mt-6 rounded-xl px-4 py-3 text-left"
        style={{ background: 'rgba(217,196,140,0.08)', border: '1px solid rgba(217,196,140,0.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ProfileAvatar src={signedUrl} nameOrEmail={nameOrDisplay} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: '#d9c48c',
                marginBottom: 2,
              }}
            >
              PHOTO ON FILE
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>
              Door staff will see this next to your pass.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowUploader(true)}
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.55)',
              fontSize: 11,
              letterSpacing: '0.14em',
              fontWeight: 700,
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '4px 8px',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            REPLACE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-6 rounded-xl px-4 py-4 text-left"
      style={{
        background: signedUrl ? 'rgba(255,255,255,0.04)' : 'rgba(217,196,140,0.08)',
        border: signedUrl ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(217,196,140,0.35)',
      }}
    >
      {!signedUrl && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.14em',
              color: '#d9c48c',
              marginBottom: 4,
            }}
          >
            PHOTO REQUIRED
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
            {'Add your face so door staff can verify it\u2019s you at check-in. Without a photo on file you will be turned away.'}
          </div>
        </div>
      )}
      <ProfilePhotoUploader
        currentSignedUrl={signedUrl}
        nameOrEmail={nameOrDisplay}
        ctaLabel="TAKE PHOTO"
        helperText="One clear photo of your face. Front camera opens by default on mobile."
        uploadFn={uploadFn}
        onUploaded={(res) => {
          setSignedUrl(res?.signedUrl || null);
          setShowUploader(false);
        }}
      />
      {signedUrl && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setShowUploader(false)}
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.55)',
              fontSize: 11,
              letterSpacing: '0.14em',
              fontWeight: 700,
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            CANCEL
          </button>
        </div>
      )}
    </div>
  );
}
