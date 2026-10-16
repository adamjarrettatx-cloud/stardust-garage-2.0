import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { profileCapabilities } from '@/lib/profile-capabilities';
import { PITCH_STATUS_LABELS } from '@/lib/date-pitches';
import WithdrawButton from './WithdrawButton';
import { isViewPortalSandbox } from '@/lib/view-portal/preview-only';
import '../programmer.css';

export const revalidate = 0;

function utcDate(iso, opts) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

function sentLabel(ts) {
  return new Date(ts).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
}

export default async function ProgrammerPitchesPage() {
  const { unauthorized, partner } = await requirePartner();
  if (unauthorized) redirect('/portal/login');
  if (!profileCapabilities(partner.contact_type).pitches) redirect('/account/profile');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('partner_my_pitches');
  if (error) console.error('[programmer pitches]', error.message);
  const previewOnly = isViewPortalSandbox();
  const pitches = (data || []).slice().sort((a, b) => b.pitch_date.localeCompare(a.pitch_date));

  return (
    <main className="pg">
      <div className="pg-shell">
        <div className="pg-intro">
          <p className="pg-eyebrow">MY PITCHES</p>
          <h1>Your pitches</h1>
          <p>Status updates appear here and by email.</p>
        </div>
        {pitches.length === 0 ? (
          <div className="pg-empty">No pitches yet. Choose an open date on the <Link href="/portal/calendar">calendar</Link> to send one.</div>
        ) : (
          <ul className="pg-list">
            {pitches.map((p) => {
              const extra = p.status === 'declined' && p.decline_reason ? ` · ${p.decline_reason}`
                : p.status === 'approved' ? ' · SDG will follow up on the details' : '';
              return (
                <li key={p.id}>
                  <div className="d">{utcDate(p.pitch_date, { month: 'short', day: 'numeric' })}<small>{utcDate(p.pitch_date, { weekday: 'short', year: 'numeric' })}</small></div>
                  <div><div className="ttl">{p.title}</div><div className="sub">Sent {sentLabel(p.created_at)}{extra}</div></div>
                  <div className="acts">
                    {p.status === 'pending' && <WithdrawButton id={p.id} disabled={previewOnly} />}
                    <span className={`pg-pill ${p.status}`}>{p.status === 'pending' ? 'Pending' : PITCH_STATUS_LABELS[p.status]}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
