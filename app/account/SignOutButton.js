'use client';

// Sign-out control for the /account chrome.
//
// Small standalone client component because Supabase signOut() must run in
// the browser (it needs to clear the sb-<ref>-auth-token cookie via the same
// SDK instance that set it). Placed here rather than the shared Navbar so
// account-scoped pages get an obvious "you are signed in as X — sign out"
// affordance without having to scroll or hunt through a menu. Once signed
// out we hard-navigate to /login so any RSC-cached account data is flushed.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch { /* swallow — we still want to bounce to /login */ }
    // Full navigation, not router.push, so all server-component caches
    // holding a stale user drop out of memory.
    window.location.href = '/login?signed_out=1';
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="disabled:opacity-50 transition-colors"
      style={{
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.15)',
        color: '#c9c9c9',
        padding: '6px 14px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: busy ? 'default' : 'pointer',
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
