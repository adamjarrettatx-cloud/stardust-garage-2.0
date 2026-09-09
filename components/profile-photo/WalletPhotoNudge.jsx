'use client';

// WalletPhotoNudge.jsx
//
// Shown at the top of /account/tickets whenever the signed-in user has a
// ticket but no profile photo. Two exposures:
//
//   1. Persistent banner — stays until they upload. Dismissible per-page-load
//      via a Later button, but re-appears on next visit if still no photo.
//   2. Auto-modal on first ticket — the first time they land on the tickets
//      page after buying, the uploader modal opens on load. Suppressed
//      afterward via localStorage so subsequent visits show only the banner.
//
// If the user already has a photo (server-side signed URL passed in), we
// render nothing — the avatar in the /account chrome + the door-scanner
// UI are enough downstream signal.

import { useEffect, useState } from 'react';
import ProfileAvatar from './ProfileAvatar';
import ProfilePhotoModal from './ProfilePhotoModal';

const LATER_KEY = 'sdg.profilePhotoNudge.later';         // dismiss for the session
const MODAL_SEEN_KEY = 'sdg.profilePhotoNudge.modalSeen'; // once-per-account after first ticket

export default function WalletPhotoNudge({
  hasPhoto,
  hasTickets,
  initialSignedUrl,
  nameOrEmail,
  autoOpenOnFirstVisit = true,
}) {
  const [dismissed, setDismissed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl || null);
  const [uploaded, setUploaded] = useState(false); // client-side flip after upload

  // Auto-open on first tickets visit when the user actually has a ticket
  // to attach the ID to. Skipped once they've seen the modal (across visits)
  // and skipped this render if they don't have a ticket yet.
  useEffect(() => {
    if (!autoOpenOnFirstVisit) return;
    if (!hasTickets || hasPhoto) return;
    try {
      if (window.sessionStorage.getItem(LATER_KEY) === '1') return;
      if (window.localStorage.getItem(MODAL_SEEN_KEY) === '1') return;
      setModalOpen(true);
      window.localStorage.setItem(MODAL_SEEN_KEY, '1');
    } catch { /* private-mode Safari — silently skip */ }
  }, [autoOpenOnFirstVisit, hasTickets, hasPhoto]);

  // Session-level dismiss respected across banner + modal.
  useEffect(() => {
    try { if (window.sessionStorage.getItem(LATER_KEY) === '1') setDismissed(true); }
    catch { /* noop */ }
  }, []);

  function markLater() {
    try { window.sessionStorage.setItem(LATER_KEY, '1'); } catch { /* noop */ }
    setDismissed(true);
    setModalOpen(false);
  }

  function handleUploaded(res) {
    setSignedUrl(res?.signedUrl || null);
    setUploaded(true);
    setModalOpen(false);
  }

  // If the user has (or just uploaded) a photo, don't show the banner.
  if (hasPhoto || uploaded) {
    // Still render the modal on the (unlikely) case where it opened before
    // the parent updated hasPhoto — but never re-open once uploaded.
    return null;
  }
  if (dismissed && !modalOpen) return null;
  if (!hasTickets) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Add your profile photo"
        style={{
          background: 'linear-gradient(135deg, #111 0%, #111 100%)',
          border: '1px solid rgba(217,196,140,0.35)',
          borderLeft: '3px solid #d9c48c',
          padding: '14px 16px',
          marginBottom: 18,
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          borderRadius: 6,
        }}
      >
        <ProfileAvatar src={signedUrl} nameOrEmail={nameOrEmail} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.12em',
              fontWeight: 700,
              color: '#d9c48c',
              marginBottom: 4,
            }}
          >
            ADD YOUR PROFILE PHOTO
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: '#e0e0e0',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            Door staff see this next to your ticket at check-in. Takes one tap.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            style={{
              appearance: 'none',
              border: 'none',
              background: '#d9c48c',
              color: '#0a0a0a',
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              cursor: 'pointer',
              textTransform: 'uppercase',
              borderRadius: 2,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            UPLOAD
          </button>
          <button
            type="button"
            onClick={markLater}
            aria-label="Dismiss for now"
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              color: '#8a8a8a',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              padding: 4,
            }}
          >
            {'\u00D7'}
          </button>
        </div>
      </div>
      <ProfilePhotoModal
        open={modalOpen}
        onClose={markLater}
        onUploaded={handleUploaded}
        currentSignedUrl={signedUrl}
        nameOrEmail={nameOrEmail}
      />
    </>
  );
}
