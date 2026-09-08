'use client';

// ProfilePhotoSection.jsx
//
// Card on the /account/profile page for viewing / replacing / removing the
// profile photo. The server hands us an initial signed URL so first paint
// shows the actual photo instead of a placeholder + fetch flash.
//
// Uses the shared <ProfilePhotoUploader> for the write path and the shared
// <ProfileAvatar> for display. Remove is client-only: DELETE the endpoint
// and drop back to placeholder locally without a full page refresh.

import { useState } from 'react';
import ProfilePhotoUploader from '@/components/profile-photo/ProfilePhotoUploader';
import { createClient } from '@/lib/supabase/client';

export default function ProfilePhotoSection({ initialSignedUrl, nameOrEmail }) {
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl || null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  async function removePhoto() {
    if (!signedUrl) return;
    if (!window.confirm('Remove your profile photo? Door staff will only see your name at check-in until you upload another.')) return;
    setRemoving(true);
    setError('');
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Session expired. Please sign in again.');
      const res = await fetch('/api/account/profile-photo', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Could not remove photo (${res.status}).`);
      }
      setSignedUrl(null);
    } catch (err) {
      setError(err?.message || 'Could not remove photo.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div
      style={{
        background: '#111',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 20,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#d9c48c', marginBottom: 6 }}>
          PROFILE PHOTO
        </div>
        <div style={{ fontSize: 13, color: '#c9c9c9', lineHeight: 1.5, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Shown to door staff next to your ticket at check-in.
        </div>
      </div>
      <ProfilePhotoUploader
        currentSignedUrl={signedUrl}
        nameOrEmail={nameOrEmail}
        onUploaded={(res) => setSignedUrl(res?.signedUrl || null)}
      />
      {signedUrl && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={removePhoto}
            disabled={removing}
            style={{
              appearance: 'none',
              background: 'transparent',
              color: '#ff8686',
              border: 'none',
              padding: 0,
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: removing ? 'not-allowed' : 'pointer',
              opacity: removing ? 0.6 : 1,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            {removing ? 'REMOVING…' : 'REMOVE PHOTO'}
          </button>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#ff8686' }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
