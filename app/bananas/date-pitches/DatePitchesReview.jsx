'use client';

import { useMemo, useState } from 'react';
import PitchCard from './PitchCard';
import { initials } from '@/app/bananas/components/SubmissionDetail';

const TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'declined', label: 'Declined' },
  { id: 'all', label: 'All' },
];

const PILL = {
  pending: { label: 'New', color: '#ffb84d', border: '#5c4420', bg: 'rgba(255,184,77,.12)' },
  approved: { label: 'Approved', color: '#86efac', border: '#1f4a33', bg: 'rgba(134,239,172,.08)' },
  declined: { label: 'Declined', color: '#a0a0a0', border: '#333', bg: 'rgba(255,255,255,.04)' },
  withdrawn: { label: 'Withdrawn', color: '#a0a0a0', border: '#333', bg: 'rgba(255,255,255,.04)' },
};

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

export default function DatePitchesReview({ pitches }) {
  const [tab, setTab] = useState('pending');
  const [selected, setSelected] = useState(null);
  const pendingCount = pitches.filter((p) => p.status === 'pending').length;
  const rows = useMemo(() => {
    const list = pitches.filter((p) => tab === 'all' || p.status === tab);
    // Pending reads soonest first; decided pitches read most recent first.
    return tab === 'pending' ? list : list.slice().sort((a, b) => b.pitch_date.localeCompare(a.pitch_date));
  }, [pitches, tab]);
  const current = rows.find((p) => p.id === selected) || rows[0] || null;

  const cell = { padding: '11px 12px', borderBottom: '1px solid var(--auth-card-border)', fontSize: 13, verticalAlign: 'middle' };
  const head = { textAlign: 'left', fontSize: 11, letterSpacing: '.06em', color: 'var(--auth-faint)', fontWeight: 600, padding: '10px 12px', borderBottom: '1px solid var(--auth-card-border)' };

  return (
    <>
      <div className="flex flex-wrap gap-[6px] mb-4" role="tablist" aria-label="Pitch status">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => { setTab(t.id); setSelected(null); }}
              className="text-[12px] px-3 py-[7px] rounded-[3px] border"
              style={{
                background: on ? 'var(--auth-text-strong, #f3f2ef)' : 'var(--auth-card-bg)',
                color: on ? 'var(--auth-strong-surface-text, #181A20)' : 'var(--auth-muted)',
                borderColor: on ? 'var(--auth-text-strong, #f3f2ef)' : 'var(--auth-card-border)',
                fontWeight: on ? 600 : 400,
              }}>
              {t.id === 'pending' ? `${t.label} (${pendingCount})` : t.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[3px] p-12 text-center border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}>
          <p style={{ color: 'var(--auth-muted)' }}>{tab === 'pending' ? 'No pitches waiting for review.' : 'Nothing here.'}</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border" style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }} aria-label="Date pitches">
              <thead><tr><th style={head}>DATE</th><th style={head}>PITCH</th><th style={head}>PROGRAMMER</th><th style={head}>STATUS</th></tr></thead>
              <tbody>
                {rows.map((p) => {
                  const sel = current?.id === p.id;
                  const pill = PILL[p.status] || PILL.declined;
                  const who = p.contacts?.display_name || p.full_name || 'Programmer';
                  const photo = p.contacts?.photo_url;
                  return (
                    <tr key={p.id} onClick={() => setSelected(p.id)} className="cursor-pointer"
                      style={{ background: sel ? 'var(--auth-card-bg-alt)' : 'transparent' }}>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <button type="button" onClick={() => setSelected(p.id)} aria-pressed={sel} className="text-left" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}>{shortDate(p.pitch_date)}</button>
                      </td>
                      <td style={{ ...cell, overflowWrap: 'anywhere' }}>{p.title}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <span className="flex items-center gap-2">
                          {photo
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={photo} alt="" width={26} height={26} className="object-cover" style={{ width: 26, height: 26, borderRadius: 3 }} />
                            : <span className="grid place-items-center text-[10px] font-bold" style={{ width: 26, height: 26, borderRadius: 3, background: 'var(--auth-card-border-strong)' }}>{initials(who)}</span>}
                          {who}
                        </span>
                      </td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        <span className="text-[11px] font-semibold px-[9px] py-[3px] rounded-[4px] border" style={{ color: pill.color, borderColor: pill.border, background: pill.bg }}>{pill.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {current && <PitchCard key={current.id} pitch={current} />}
        </div>
      )}
    </>
  );
}
