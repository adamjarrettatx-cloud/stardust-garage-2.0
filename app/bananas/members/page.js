import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import { PLAN_DISPLAY } from '@/lib/stripe-prices';
import AdminMemberActions from './AdminMemberActions';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function initials(name, email) {
  const source = (name || email || '').trim();
  if (!source) return '?';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
}

function Avatar({ member }) {
  if (member.photo_url) {
    return (
      <img
        src={member.photo_url}
        alt={member.full_name || member.email}
        className="w-11 h-11 flex-shrink-0 object-cover"
        style={{ borderRadius: '50%', border: '1px solid #2a2a2a' }}
      />
    );
  }
  return (
    <div
      className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-[14px] font-bold"
      style={{
        borderRadius: '50%',
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        color: '#8a8a8a',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {initials(member.full_name, member.email)}
    </div>
  );
}

export default async function AdminMembersPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  const { data: members } = await supabase
    .from('member_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  const active = (members || []).filter((m) => m.is_active);
  const inactive = (members || []).filter((m) => !m.is_active);

  return (
    <>
      <AuthenticatedPageHeader
        title="Members"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />

      <div className="mb-12">
        <div className="text-[11px] font-semibold tracking-[0.18em] mb-4" style={{ color: '#8a8a8a' }}>
          ACTIVE ({active.length})
        </div>
        {active.length === 0 ? (
          <div className="rounded-[14px] border p-8 text-center" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
            <p style={{ color: '#8a8a8a' }}>No active members yet.</p>
          </div>
        ) : (
          active.map((m) => <MemberRow key={m.id} member={m} />)
        )}
      </div>

      {inactive.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold tracking-[0.18em] mb-4" style={{ color: '#8a8a8a' }}>
            INACTIVE / PENDING ({inactive.length})
          </div>
          {inactive.map((m) => <MemberRow key={m.id} member={m} />)}
        </div>
      )}
    </>
  );
}

function MemberRow({ member }) {
  const statusLabel = {
    active: 'ACTIVE',
    past_due: 'PAYMENT FAILED',
    cancelled: 'CANCELLED',
    pending: 'PENDING ACTIVATION',
    incomplete: 'INCOMPLETE',
  }[member.subscription_status] || 'UNKNOWN';

  const statusColor = {
    active: { bg: 'rgba(80,200,120,0.15)', fg: '#80c878' },
    past_due: { bg: 'rgba(255,184,77,0.15)', fg: '#ffb84d' },
    cancelled: { bg: 'rgba(255,80,80,0.15)', fg: '#ff8080' },
    pending: { bg: 'rgba(255,255,255,0.08)', fg: '#aaa' },
    incomplete: { bg: 'rgba(255,80,80,0.15)', fg: '#ff8080' },
  }[member.subscription_status] || { bg: 'rgba(255,255,255,0.08)', fg: '#aaa' };

  return (
    <div
      className="rounded-[14px] border p-5 mb-3 flex items-center gap-5"
      style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <Avatar member={member} />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {member.full_name || member.email}
        </div>
        <div className="text-[12px]" style={{ color: '#a0a0a0' }}>
          {member.email}
        </div>
        <div className="text-[11px] mt-1.5" style={{ color: '#555' }}>
          {member.subscription_plan ? PLAN_DISPLAY[member.subscription_plan] || member.subscription_plan : 'No plan'}
          {member.subscription_period ? ` · ${member.subscription_period}` : ''}
          {member.current_period_end ? ` · Next renewal: ${formatDate(member.current_period_end)}` : ''}
          {member.cancel_at_period_end ? ' · WILL CANCEL AT PERIOD END' : ''}
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <div
          className="text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
          style={{ background: statusColor.bg, color: statusColor.fg }}
        >
          {statusLabel}
        </div>
        {member.subscription_status === 'active' && !member.cancel_at_period_end && member.stripe_subscription_id && (
          <AdminMemberActions memberId={member.id} />
        )}
      </div>
    </div>
  );
}
