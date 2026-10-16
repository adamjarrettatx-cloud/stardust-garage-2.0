'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { attendanceLabel, longDateLabel, timeRangeLabel } from '@/lib/date-pitches';

const muted = { color: 'var(--auth-muted)' };
const faint = { color: 'var(--auth-faint)' };
const btn = {
  borderRadius: 3, border: '1px solid var(--auth-card-border-strong)', background: 'var(--auth-card-bg-alt)',
  padding: '9px 12px', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: 'var(--auth-text)',
  display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
};
const primary = { ...btn, background: 'var(--auth-text-strong, #f3f2ef)', color: 'var(--auth-strong-surface-text, #181A20)', borderColor: 'var(--auth-text-strong, #f3f2ef)' };

function dayLabel(ts) {
  return ts ? new Date(ts).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }) : '';
}

export default function PitchCard({ pitch, showDetailLink = true }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const who = pitch.contacts?.display_name || pitch.full_name || 'Programmer';

  const act = async (kind) => {
    if (kind === 'approve' && !window.confirm(`Approve "${pitch.title}" and create a Draft event on ${longDateLabel(pitch.pitch_date)}?`)) return;
    setBusy(kind); setError('');
    try {
      const res = await fetch(`/api/admin/date-pitches/${pitch.id}/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: kind === 'decline' ? JSON.stringify({ reason }) : '{}',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'That did not go through. Try again.');
      setResult({ kind, ...json });
      setDeclining(false);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const rows = [
    ['Time', timeRangeLabel(pitch.start_time, pitch.end_time)],
    ['Attendance', attendanceLabel(pitch.expected_attendance)],
    ['Lineup', pitch.lineup],
    ['Concept', pitch.concept],
    ['Anything else', pitch.notes],
  ].filter(([, v]) => v);

  return (
    <div className="rounded-[3px] border p-[18px]" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
      <h3 className="text-[17px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", overflowWrap: 'anywhere' }}>{pitch.title}</h3>
      <p className="text-[12px] mt-1 mb-[14px]" style={muted}>
        {longDateLabel(pitch.pitch_date)} · from {who}{pitch.email ? ` (${pitch.email})` : ''} · sent {dayLabel(pitch.created_at)}
      </p>
      {pitch.status === 'pending' && !result && pitch.otherPending > 0 && (
        <div className="text-[12px] mb-[14px] px-[11px] py-[9px] rounded-[3px] border" style={{ background: '#3F3F3F', borderColor: '#555', color: '#eee' }}>
          Another pitch is pending for this date. Approving one declines the other with a &quot;date filled&quot; note.
        </div>
      )}
      {pitch.status === 'pending' && !result && pitch.dateTaken && (
        <div className="text-[12px] mb-[14px] px-[11px] py-[9px] rounded-[3px] border" style={{ background: '#3F3F3F', borderColor: '#555', color: '#eee' }}>
          This date now has an event or calendar entry. Check the calendar before approving.
        </div>
      )}
      <dl className="grid gap-x-3 gap-y-2 mb-[14px] text-[13px]" style={{ gridTemplateColumns: '110px minmax(0,1fr)' }}>
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt style={faint}>{k}</dt><dd className="m-0" style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{v}</dd></div>
        ))}
      </dl>

      {result ? (
        <p className="text-[13px] m-0" style={muted}>
          {result.kind === 'approve'
            ? <>Approved. Draft event created{result.autoDeclined ? `, and ${result.autoDeclined} other pitch${result.autoDeclined === 1 ? ' was' : 'es were'} declined as date filled` : ''}. {result.eventId && <Link href={`/bananas/events/${result.eventId}`} className="underline" style={{ color: 'var(--auth-text)' }}>Open draft event</Link>}</>
            : 'Declined. The Programmer was emailed.'}
        </p>
      ) : pitch.status === 'pending' ? (
        <>
          {declining && (
            <div className="mb-3">
              <label htmlFor={`reason-${pitch.id}`} className="block text-[12px] mb-1" style={muted}>Note to the Programmer (optional)</label>
              <textarea id={`reason-${pitch.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3}
                className="w-full rounded-[3px] border px-[11px] py-[9px] text-[13px]"
                style={{ background: 'var(--auth-card-bg-alt)', borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }} />
            </div>
          )}
          {error && <p className="text-[13px] mb-3" role="alert" style={{ color: '#e99797' }}>{error}</p>}
          <div className="flex flex-wrap gap-2">
            {declining ? (
              <>
                <button type="button" style={primary} disabled={!!busy} onClick={() => act('decline')}>{busy === 'decline' ? 'Declining…' : 'Decline pitch'}</button>
                <button type="button" style={btn} disabled={!!busy} onClick={() => setDeclining(false)}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" style={primary} disabled={!!busy} onClick={() => act('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve as draft event'}</button>
                <Link href={`/bananas/date-pitches/${pitch.id}#conversation`} style={btn}>Message</Link>
                <button type="button" style={btn} disabled={!!busy} onClick={() => setDeclining(true)}>Decline</button>
              </>
            )}
          </div>
          <p className="text-[12px] mt-3 mb-0" style={faint}>
            Approve creates a Draft event on this date with the Programmer as organizer. It still needs Go Live to appear publicly.
          </p>
        </>
      ) : (
        <p className="text-[13px] m-0" style={muted}>
          {pitch.status === 'approved' && <>Draft event created {dayLabel(pitch.decided_at)}. {pitch.event_id && <Link href={`/bananas/events/${pitch.event_id}`} className="underline" style={{ color: 'var(--auth-text)' }}>Open event</Link>}</>}
          {pitch.status === 'declined' && `Declined ${dayLabel(pitch.decided_at)}${pitch.decline_reason ? `: ${pitch.decline_reason}` : '.'}`}
          {pitch.status === 'withdrawn' && 'Withdrawn by the Programmer.'}
        </p>
      )}
      {showDetailLink && (
        <p className="text-[12px] mt-4 mb-0"><Link href={`/bananas/date-pitches/${pitch.id}`} className="underline" style={muted}>Open full pitch, messages and team notes</Link></p>
      )}
    </div>
  );
}
