'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function CollaborationActions({ collaborationId, currentStatus }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  // Auto-mark as reviewed when the detail page is first opened (if still 'new')
  useEffect(() => {
    if (currentStatus === 'new') {
      const supabase = createClient();
      supabase
        .from('collaborations')
        .update({ status: 'reviewed' })
        .eq('id', collaborationId)
        .then(() => router.refresh());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (newStatus) => {
    setWorking(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('collaborations')
      .update({ status: newStatus })
      .eq('id', collaborationId);

    if (error) {
      alert('Error: ' + error.message);
      setWorking(false);
      return;
    }
    router.refresh();
    setWorking(false);
  };

  const handleDelete = async () => {
    const confirmed = window.confirm('Permanently delete this submission?');
    if (!confirmed) return;

    setWorking(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('collaborations')
      .delete()
      .eq('id', collaborationId);

    if (error) {
      alert('Error: ' + error.message);
      setWorking(false);
      return;
    }
    router.push('/bananas/collaborations');
    router.refresh();
  };

  const btnBase =
    'px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all hover:-translate-y-0.5 disabled:opacity-50';

  return (
    <div className="flex flex-wrap gap-2">
      {/* ── Approve ───────────────────────────────────── */}
      {currentStatus !== 'approved' && (
        <button
          onClick={() => updateStatus('approved')}
          disabled={working}
          className={btnBase}
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          APPROVE
        </button>
      )}

      {/* ── Mark Reviewed ─────────────────────────────── */}
      {currentStatus !== 'reviewed' && currentStatus !== 'approved' && currentStatus !== 'rejected' && (
        <button
          onClick={() => updateStatus('reviewed')}
          disabled={working}
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
          onClick={() => updateStatus('pending')}
          disabled={working}
          className={`${btnBase} border hover:bg-white/5`}
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          MARK PENDING
        </button>
      )}

      {/* ── Reject ────────────────────────────────────── */}
      {currentStatus !== 'rejected' && (
        <button
          onClick={() => updateStatus('rejected')}
          disabled={working}
          className={`${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          REJECT
        </button>
      )}

      {/* ── Delete ────────────────────────────────────── */}
      <button
        onClick={handleDelete}
        disabled={working}
        className={`ml-auto ${btnBase} border hover:bg-red-500/10 hover:border-red-500/40`}
        style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
      >
        DELETE
      </button>
    </div>
  );
}
