'use client';

// ProfilePhotoModal.jsx
//
// Full-screen overlay wrapper around <ProfilePhotoUploader>. Used by the
// wallet nudge and anywhere else we want a focused "upload now" moment
// without navigating away.
//
// Not a full portal for simplicity — a fixed-position overlay works for
// our single-page use cases and doesn't need a portal container.

import { useEffect } from 'react';
import ProfilePhotoUploader from './ProfilePhotoUploader';

export default function ProfilePhotoModal({
  open,
  onClose,
  onUploaded,
  currentSignedUrl,
  nameOrEmail,
  title = 'ADD YOUR PROFILE PHOTO',
  subtitle = 'Door staff will see this next to your ticket at check-in so we know it\u2019s really you. Takes one tap on your phone.',
  dismissible = true,
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) return;
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: '0',
      }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#0f0f0f',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '22px 20px 26px',
          borderRadius: '12px 12px 0 0',
          boxShadow: '0 -20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: '#d9c48c',
                marginBottom: 6,
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: '#c9c9c9',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}
            >
              {subtitle}
            </div>
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
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
          )}
        </div>
        <ProfilePhotoUploader
          currentSignedUrl={currentSignedUrl}
          nameOrEmail={nameOrEmail}
          onUploaded={(res) => { onUploaded?.(res); }}
        />
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: 14,
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              color: '#8a8a8a',
              fontSize: 12,
              letterSpacing: '0.08em',
              cursor: 'pointer',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            {'I\u2019LL DO IT LATER'}
          </button>
        )}
      </div>
    </div>
  );
}
