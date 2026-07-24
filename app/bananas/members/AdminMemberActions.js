'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

export default function AdminMemberActions({ memberId }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function handleCancel() {
    const confirmed = window.confirm(
      'Cancel this member\'s subscription? They\'ll keep access until the end of their current billing period.'
    );
    if (!confirmed) return;

    setWorking(true);
    try {
      await adminFetch('/api/admin/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      alert('Subscription will be cancelled at the end of the current billing period.');
      router.refresh();
    } catch (err) {
      alert('Error: ' + (err?.message || 'Unknown'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCancel}
      disabled={working}
      className="px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.12em] border transition-colors hover:bg-red-500/10 hover:border-red-500/40 disabled:opacity-50"
      style={{ borderColor: 'var(--fg-a15)', color: 'var(--text-1)' }}
    >
      CANCEL SUBSCRIPTION
    </button>
  );
}
