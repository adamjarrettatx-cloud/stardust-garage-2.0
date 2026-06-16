'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function MicroPartyActions({ inquiryId, currentStatus }) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');

  // Auto-mark as reviewed when the detail page is first opened (if still 'new')
  useEffect(() => {
    if (currentStatus === 'new') {
      const supabase = createClient();
      supabase
        .from('micro_party_inquiries')
        .update({ status: 'reviewed' })
        .eq('id', inquiryId)
        .then(() => router.refresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (newStatus) => {
    setUpdating(true);
    setError('');
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from('micro_party_inquiries')
      .update({ status: newStatus })
      .eq('id', inquiryId);

    if (updateError) {
      setError(updateError.message);
      setUpdating(false);
      return;
    }

    setUpdating(false);
    router.refresh();
  };

  const btnBase =
    'px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50';

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {/* ── Approve ───────────────────────────────────── */}
        <button
          type="button"
          disabled={updating || currentStatus === 'approved'}
          onClick={() => updateStatus('approved')}
          className={btnBase}
          style={{
            background: currentStatus === 'approved' ? 'rgba(34,197,94,0.15)' : '#22c55e',
            color: currentStatus === 'approved' ? '#4ade80' : '#0a0a0a',
            border: '1px solid rgba(34,197,94,0.3)',
          }}
        >
          {currentStatus === 'approved' ? '✓ APPROVED' : 'APPROVE'}
        </button>

        {/* ── Mark Reviewed ─────────────────────────────── */}
        {currentStatus !== 'reviewed' && currentStatus !== 'approved' && currentStatus !== 'rejected' && (
          <button
            type="button"
            disabled={updating}
            onClick={() => updateStatus('reviewed')}
            className={btnBase}
            style={{
              background: 'rgba(168,85,247,0.12)',
              color: '#c084fc',
              border: '1px solid rgba(168,85,247,0.3)',
            }}
          >
            MARK REVIEWED
          </button>
        )}

        {/* ── Mark Pending ──────────────────────────────── */}
        {currentStatus !== 'pending' && (
          <button
            type="button"
            disabled={updating}
            onClick={() => updateStatus('pending')}
            className={btnBase}
            style={{
              background: 'transparent',
              color: '#a0a0a0',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            MARK PENDING
          </button>
        )}

        {/* ── Reject ────────────────────────────────────── */}
        <button
          type="button"
          disabled={updating || currentStatus === 'rejected'}
          onClick={() => updateStatus('rejected')}
          className={btnBase}
          style={{
            background: currentStatus === 'rejected' ? 'rgba(239,68,68,0.15)' : 'transparent',
            color: currentStatus === 'rejected' ? '#f87171' : '#f5f5f5',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          {currentStatus === 'rejected' ? '✗ REJECTED' : 'REJECT'}
        </button>
      </div>

      {error && (
        <div className="text-[13px] text-red-400 mt-3">
          {error}
        </div>
      )}
    </div>
  );
}
