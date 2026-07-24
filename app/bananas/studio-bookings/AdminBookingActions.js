'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminBookingActions({ bookingId }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function handleCancel() {
    const confirmed = window.confirm(
      'Cancel this booking as admin? (Bypasses 24hr rule.)'
    );
    if (!confirmed) return;

    setWorking(true);
    try {
      const res = await fetch('/api/studio/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert('Error: ' + (body?.error || 'Failed'));
        setWorking(false);
        return;
      }
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
      style={{
        borderColor: 'rgba(255,255,255,0.15)',
        color: '#f5f5f5',
      }}
    >
      CANCEL
    </button>
  );
}
