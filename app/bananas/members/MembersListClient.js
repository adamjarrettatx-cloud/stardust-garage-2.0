'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PLAN_DISPLAY } from '@/lib/stripe-prices';
import UnderlineTabs from '../components/UnderlineTabs';
import AdminMemberActions from './AdminMemberActions';
import MemberAvatar from './MemberAvatar';
import { formatMemberDate, memberStatusLabel, memberStatusTone } from './member-display';

// Active / Inactive-Pending used to be two stacked sections with a small caps
// label each, so the whole list was always on screen at once and there was no
// way to look at just one group. They are now one UnderlineTabs strip — the
// same component the other seven in-page filters use — and only the selected
// group's rows render.
//
// Search lives above the tabs (matching Contacts) because it filters across
// whichever tab is open rather than being scoped to one of them.
export default function MembersListClient({ members }) {
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');

  const { active, inactive } = useMemo(() => {
    const list = members || [];
    return {
      active: list.filter((m) => m.is_active),
      inactive: list.filter((m) => !m.is_active),
    };
  }, [members]);

  const visible = useMemo(() => {
    const group = tab === 'active' ? active : inactive;
    const q = query.trim().toLowerCase();
    if (!q) return group;
    return group.filter((m) =>
      [m.full_name, m.email, m.subscription_plan, m.subscription_status].some((v) =>
        (v || '').toLowerCase().includes(q)
      )
    );
  }, [tab, active, inactive, query]);

  const tabs = [
    { id: 'active', label: 'Active', count: active.length, color: 'var(--auth-success)' },
    {
      id: 'inactive',
      label: 'Inactive / Pending',
      count: inactive.length,
      color: 'var(--auth-muted-strong)',
    },
  ];

  const emptyCopy =
    tab === 'active'
      ? 'No active members yet.'
      : 'No inactive or pending members — everyone on the roster is active.';

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, email, plan…"
        className="w-full max-w-[420px] mb-5 px-5 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30"
        style={{
          background: 'var(--auth-input-bg)',
          borderColor: 'var(--auth-input-border)',
          color: 'var(--auth-input-text)',
        }}
      />

      <UnderlineTabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        ariaLabel="Filter members by status"
        className="mb-6"
      />

      {visible.length === 0 ? (
        <div
          className="rounded-[14px] border p-12 text-center"
          style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
        >
          <p style={{ color: 'var(--auth-muted)' }}>
            {query.trim() ? 'No members match this search.' : emptyCopy}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </div>
      )}
    </>
  );
}

function MemberRow({ member }) {
  const tone = memberStatusTone(member.subscription_status);

  const planLine = [
    member.subscription_plan
      ? PLAN_DISPLAY[member.subscription_plan] || member.subscription_plan
      : 'No plan',
    member.subscription_period || null,
    member.current_period_end ? `Next renewal: ${formatMemberDate(member.current_period_end)}` : null,
    member.cancel_at_period_end ? 'WILL CANCEL AT PERIOD END' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="rounded-[14px] border p-5 flex items-center gap-5 transition-colors"
      style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
    >
      {/* The link covers avatar + identity only, not the whole card: the actions
          column holds a real <button>, which cannot legally nest inside an
          anchor and would swallow the click if it did. */}
      <Link
        href={`/bananas/members/${member.id}`}
        className="flex items-center gap-5 flex-1 min-w-0 group"
      >
        <MemberAvatar member={member} />
        <div className="flex-1 min-w-0">
          <div
            className="text-[15px] font-bold mb-1 group-hover:underline"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'var(--auth-text-strong)' }}
          >
            {member.full_name || member.email}
          </div>
          <div className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
            {member.email}
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--auth-faint)' }}>
            {planLine}
          </div>
        </div>
      </Link>

      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <div
          className="text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {memberStatusLabel(member.subscription_status)}
        </div>
        {member.subscription_status === 'active' &&
          !member.cancel_at_period_end &&
          member.stripe_subscription_id && <AdminMemberActions memberId={member.id} />}
      </div>
    </div>
  );
}
