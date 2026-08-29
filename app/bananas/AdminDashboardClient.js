'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  resolveAdminTab,
  visibleAdminTabGroups,
  adminTabById,
} from '@/lib/admin-tabs';

// ---------------------------------------------------------------------------
// Eyebrow vocabulary
// ---------------------------------------------------------------------------
// The small caps label on each tile used to mix three unrelated ideas: actions
// (REVIEW, MANAGE, TRACK), permissions (TEAM ONLY, OWNER ONLY, PRIVATE) and
// status (NEW, LIVE). Staff couldn't learn a pattern because there wasn't one —
// "PRIVATE" and "REPORTING" told you nothing comparable about the two tiles
// they sat on.
//
// Now the eyebrow answers exactly one question: what kind of work is this?
//   REVIEW — items are queued and waiting on a decision from you
//   MANAGE — you create and edit records here
//   VIEW   — read-only; look something up
//   TRACK  — ongoing progress you check in on
//
// Permissions moved to a lock marker (`restricted`) and status moved to its own
// pill (`status`), so all three signals stay visible without competing for the
// same slot.
const ACTIONS = ['REVIEW', 'MANAGE', 'VIEW', 'TRACK'];

const RESTRICTION_LABELS = {
  owner: 'Owner only',
  team: 'Team only',
};

// ---------------------------------------------------------------------------
// Tile content, keyed by tab id
// ---------------------------------------------------------------------------
// Declared as data rather than JSX so the eyebrow vocabulary is auditable at a
// glance (and testable — see tests/admin-tabs.test.mjs).
function tilesFor(counts) {
  return {
    team: [
      { href: '/team/progress', action: 'TRACK', title: 'Tasks', sub: 'Assigned work by department' },
      { href: '/team/calendar', action: 'VIEW', title: 'Team Calendar', sub: 'Shifts and internal dates', restricted: 'team' },
      { href: '/team/chat', action: 'VIEW', title: 'Team Chat', sub: 'Internal channels', count: counts.unreadChat, status: 'NEW' },
    ],
    memberships: [
      { href: '/bananas/applications', action: 'REVIEW', title: 'Applications', sub: 'Awaiting your decision', count: counts.applications },
      { href: '/bananas/members', action: 'MANAGE', title: 'Members', sub: 'Active roster and billing', count: counts.pastDueMembers },
    ],
    people: [
      { href: '/bananas/contacts', action: 'VIEW', title: 'Contacts', sub: 'Everyone in the database' },
      { href: '/bananas/collaborations', action: 'REVIEW', title: 'Collaborations', sub: 'Inbound partnership requests', count: counts.collaborations },
      { href: '/bananas/signups', action: 'VIEW', title: 'Signups', sub: 'Mailing list additions', count: counts.newSignups },
      { href: '/bananas/guest-list', action: 'MANAGE', title: 'Guest List', sub: 'Per-event entry grants' },
      { href: '/bananas/pay-requests', action: 'REVIEW', title: 'Artist Pay', sub: 'Payout requests', count: counts.pendingPayRequests },
    ],
    rentals: [
      { href: '/bananas/venue-inquiries', action: 'REVIEW', title: 'Venue Inquiries', sub: 'Full-venue requests', count: counts.venueInquiries },
      { href: '/bananas/micro-parties', action: 'REVIEW', title: 'Micro Parties', sub: 'Small private bookings', count: counts.microParties },
      { href: '/bananas/studio-bookings', action: 'MANAGE', title: 'Studio Bookings', sub: 'Hourly studio time', count: counts.upcomingBookings },
    ],
    documents: [
      { href: '/bananas/documents', action: 'VIEW', title: 'Documents', sub: 'Signed and internal files', restricted: 'team' },
    ],
    analytics: [
      { href: '/bananas/financials', action: 'VIEW', title: 'Financials', sub: 'Revenue and expenses', restricted: 'owner' },
      { href: '/bananas/cash-flow', action: 'VIEW', title: 'Cash Flow', sub: 'Money in and out', restricted: 'owner' },
      { href: '/capacity', action: 'VIEW', title: 'Capacity Counter', sub: 'Real-time headcount', status: 'LIVE' },
    ],
    settings: [
      { href: '/bananas/settings', action: 'MANAGE', title: 'Settings', sub: 'Venue configuration' },
      { href: '/bananas/studio-settings', action: 'MANAGE', title: 'Studio Settings', sub: 'Rates and hours', restricted: 'owner' },
      { href: '/bananas/team', action: 'MANAGE', title: 'Team Members', sub: 'Logins and roles', restricted: 'owner' },
      { href: '/bananas/security', action: 'MANAGE', title: 'Security / MFA', sub: 'Your sign-in protection' },
    ],
  };
}

// Sum of the counts on a tab's own tiles, so the number beside a section in the
// sidebar always matches what you find after opening it.
function badgeFor(tabId, tiles) {
  return (tiles[tabId] || []).reduce((sum, t) => sum + (t.count || 0), 0);
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------
function Tile({ href, action, title, sub, count = 0, restricted, status }) {
  const isHighlighted = count > 0;
  return (
    <Link
      href={href}
      className="relative rounded-[14px] p-5 pb-[21px] border transition-all hover:-translate-y-px"
      style={{
        background: isHighlighted ? 'var(--auth-warn-bg)' : 'var(--auth-card-bg)',
        borderColor: isHighlighted ? 'var(--auth-warn-border)' : 'var(--auth-card-border)',
      }}
    >
      <div className="flex items-center gap-2 mb-[9px] pr-8">
        <span
          className="text-[11px] font-bold tracking-[0.12em]"
          style={{ color: 'var(--auth-muted)' }}
        >
          {action}
        </span>
        {status && (
          <span
            className="text-[10.5px] font-bold tracking-[0.1em] px-[6px] py-[3px] rounded-[5px] leading-none"
            style={{
              background: 'var(--auth-ghost-bg)',
              color: 'var(--auth-muted)',
              border: '1px solid var(--auth-ghost-border)',
            }}
          >
            {status}
          </span>
        )}
      </div>

      <div
        className="text-[17.5px] font-bold -tracking-[0.015em]"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {title}
      </div>

      {sub && (
        <div
          className="text-[13.5px] mt-[6px] leading-[1.45]"
          style={{ color: 'var(--auth-muted)' }}
        >
          {sub}
        </div>
      )}

      {restricted && (
        <div
          className="flex items-center gap-[6px] mt-[11px] text-[12px] font-semibold tracking-[0.02em]"
          style={{ color: 'var(--auth-muted)' }}
        >
          <LockIcon />
          {RESTRICTION_LABELS[restricted]}
        </div>
      )}

      {count > 0 && (
        <span
          className="absolute top-3.5 right-3.5 inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-full text-[12.5px] font-bold leading-none"
          style={{
            background: 'var(--auth-accent)',
            color: 'var(--auth-accent-text)',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
          aria-label={`${count} pending`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
// Replaces the old horizontal pill bar. Every destination is visible at once,
// so a staff member never has to click through tabs to discover what exists,
// and the grouping (Operations / Money / Admin) teaches the structure without
// anyone reading a manual. It also keeps working as sections are added, which a
// single row of pills does not.
//
// Below the lg breakpoint the group headings drop away and this degrades to a
// horizontally scrolling row.
function Sidebar({ groups, active, onSelect, badges }) {
  return (
    <nav
      className="flex gap-2 overflow-x-auto pb-1.5 lg:block lg:overflow-visible lg:pb-0 lg:sticky lg:top-6"
      role="tablist"
      aria-label="Admin sections"
      aria-orientation="vertical"
    >
      {groups.map(({ group, tabs }, groupIndex) => (
        <div key={group} className="contents lg:block">
          <div
            className={`hidden lg:block text-[11px] font-bold tracking-[0.14em] px-3 mb-2 ${
              groupIndex === 0 ? '' : 'mt-[26px]'
            }`}
            style={{ color: 'var(--auth-muted)' }}
          >
            {group}
          </div>

          {tabs.map((tab) => {
            const isActive = tab.id === active;
            const badge = badges[tab.id] || 0;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`admin-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`admin-panel-${tab.id}`}
                onClick={() => onSelect(tab.id)}
                className="shrink-0 lg:w-full flex items-center justify-between gap-2.5 text-left text-[15.5px] font-semibold -tracking-[0.01em] px-3 py-[11px] rounded-[10px] transition-colors whitespace-nowrap lg:whitespace-normal"
                style={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  background: isActive ? 'var(--auth-card-bg)' : 'transparent',
                  color: isActive ? 'var(--auth-text)' : 'var(--auth-muted)',
                  fontWeight: isActive ? 700 : 600,
                  boxShadow: isActive
                    ? 'inset 3px 0 0 var(--auth-accent), 0 1px 2px rgba(0,0,0,0.06)'
                    : 'none',
                  cursor: 'pointer',
                }}
              >
                <span>{tab.label}</span>
                {badge > 0 && (
                  <span
                    className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11.5px] font-bold leading-none"
                    style={{
                      background: 'var(--auth-accent)',
                      color: 'var(--auth-accent-text)',
                    }}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------
export default function AdminDashboardClient({ isOwner, counts, initialTab }) {
  const tiles = tilesFor(counts);
  const groups = visibleAdminTabGroups(isOwner);

  // `initialTab` is resolved server-side from ?tab= so a deep link renders the
  // right section on first paint with no flash of the default tab.
  const [activeTab, setActiveTab] = useState(() =>
    resolveAdminTab(initialTab, { isOwner })
  );

  // Selecting a section writes it to the URL with history.pushState rather than
  // router.push. That gives real deep links, working browser back/forward and a
  // shareable address per section, while keeping the switch instant — this page
  // is `revalidate = 0`, so a router.push would re-run every count query in
  // page.js just to move between tabs.
  const selectTab = useCallback(
    (id) => {
      const next = resolveAdminTab(id, { isOwner });
      setActiveTab(next);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.pushState(null, '', url);
    },
    [isOwner]
  );

  // Keep the rendered section in sync when the user presses back/forward.
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setActiveTab(resolveAdminTab(params.get('tab'), { isOwner }));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isOwner]);

  const badges = Object.fromEntries(
    Object.keys(tiles).map((id) => [id, badgeFor(id, tiles)])
  );

  const section = adminTabById(activeTab);
  const sectionTiles = tiles[activeTab] || [];

  return (
    <div className="lg:grid lg:grid-cols-[232px_1fr] lg:gap-9 lg:items-start">
      <Sidebar
        groups={groups}
        active={activeTab}
        onSelect={selectTab}
        badges={badges}
      />

      <div
        id={`admin-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${activeTab}`}
        className="mt-6 lg:mt-0"
      >
        {section && (
          <>
            <h2
              className="text-[23px] font-bold -tracking-[0.02em] mb-[4px]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {section.label}
            </h2>
            <p
              className="text-[14.5px] mb-[20px] leading-[1.5]"
              style={{ color: 'var(--auth-muted)' }}
            >
              {section.description}
            </p>
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {sectionTiles.map((tile) => (
            <Tile key={tile.href} {...tile} />
          ))}
        </div>
      </div>
    </div>
  );
}

export { ACTIONS, tilesFor, badgeFor };
