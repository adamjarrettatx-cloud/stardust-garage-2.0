'use client';

// ProfileAvatar.jsx
//
// Read-only rendering of a profile photo (or an initials placeholder when
// none exists yet). Consumed by:
//   - /account layout signed-in strip (top-right chip)
//   - Wallet nudge banner / modal (preview of current photo)
//   - Door-scanner UI (large avatar next to the ticket verdict) — pass a
//     size prop for big display
//
// The `src` should already be a short-lived signed URL from the private
// `profile-photos` bucket. Never wire this to a raw storage path — that
// would leak biometric data behind a guessable CDN URL. See
// lib/profile-photo.js for the signed-URL minter.

import { useMemo } from 'react';

function initialsFrom(nameOrEmail) {
  if (!nameOrEmail) return '·';
  const cleaned = String(nameOrEmail).trim();
  if (!cleaned) return '·';
  // Name path: take first + last initial
  if (cleaned.includes(' ')) {
    const parts = cleaned.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
  }
  // Email path: take first two letters of the local part
  if (cleaned.includes('@')) {
    return cleaned.split('@')[0].slice(0, 2).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export default function ProfileAvatar({
  src,
  nameOrEmail,
  size = 40,
  ring = false,
  alt = 'Profile photo',
  className = '',
  style = {},
}) {
  const initials = useMemo(() => initialsFrom(nameOrEmail), [nameOrEmail]);
  const px = typeof size === 'number' ? `${size}px` : size;
  const borderRadius = '50%';

  const baseStyle = {
    width: px,
    height: px,
    borderRadius,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    background: '#141414',
    color: '#e0e0e0',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontWeight: 700,
    letterSpacing: '0.02em',
    fontSize: `${Math.max(11, Math.round((typeof size === 'number' ? size : 40) * 0.36))}px`,
    lineHeight: 1,
    userSelect: 'none',
    boxShadow: ring ? '0 0 0 2px rgba(255,255,255,0.15), 0 0 0 4px rgba(0,0,0,0.6)' : 'none',
    ...style,
  };

  if (src) {
    return (
      <span className={className} style={baseStyle} aria-label={alt} role="img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          width={typeof size === 'number' ? size : undefined}
          height={typeof size === 'number' ? size : undefined}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span className={className} style={baseStyle} aria-label={alt} role="img">
      {initials}
    </span>
  );
}
