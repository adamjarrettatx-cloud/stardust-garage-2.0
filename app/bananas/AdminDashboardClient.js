'use client';

import { useState } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------
function Tile({ href, eyebrow, title, count = 0 }) {
  const isHighlighted = count > 0;
  return (
    <Link
      href={href}
      className="relative rounded-[14px] p-5 border transition-colors hover:border-white/20"
      style={{
        background: isHighlighted ? 'var(--auth-warn-bg)' : 'var(--auth-card-bg)',
        borderColor: isHighlighted ? 'var(--auth-warn-border)' : 'var(--auth-card-border)',
      }}
    >
      <div
        className="text-[10px] font-semibold tracking-[0.14em] mb-1.5"
        style={{ color: 'var(--auth-muted)' }}
      >
        {eyebrow}
      </div>
      <div
        className="text-[15px] font-bold"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {title}
      </div>
      {count > 0 && (
        <span
          className="absolute top-3 right-3 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold leading-none"
          style={{
            background: 'var(--auth-accent)',
            color: 'var(--auth-accent-text)',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
          aria-label={`${count} new`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------
function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 mb-8 flex-wrap" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className="px-4 py-2 rounded-[14px] text-[12px] font-semibold tracking-[0.1em] transition-colors"
            style={{
              background: isActive ? 'var(--auth-accent)' : 'var(--auth-ghost-bg)',
              color: isActive ? 'var(--auth-accent-text)' : 'var(--auth-ghost-text)',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              border: `1px solid ${isActive ? 'var(--auth-accent)' : 'var(--auth-ghost-border)'}`,
              cursor: 'pointer',
            }}
          >
            {tab.label}
            {tab.badge > 0 && (
              <span
                className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none"
                style={{
                  background: isActive ? 'rgba(0,0,0,0.25)' : 'var(--auth-accent)',
                  color: 'var(--auth-accent-text)',
                }}
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------
export default function AdminDashboardClient({ isOwner, counts }) {
  // Build tabs based on role
  //
  // "Submissions" used to lump every inbound-people form together. It's now
  // split in two:
  //   - Community: people relating to membership (applications,
  //     collaborations, signups).
  //   - Rentals: people relating to renting the space (venue inquiries,
  //     micro parties).
  const communityBadge =
    counts.applications +
    counts.collaborations +
    counts.newSignups +
    (counts.pendingPayRequests || 0);

  const rentalsBadge =
    counts.venueInquiries +
    counts.microParties;

  const allTabs = [
    { id: 'team', label: 'Team', ownerOnly: false, badge: counts.unreadChat },
    { id: 'community', label: 'Community', ownerOnly: false, badge: communityBadge },
    { id: 'rentals', label: 'Rentals', ownerOnly: false, badge: rentalsBadge },
    { id: 'studio', label: 'Studio', ownerOnly: false, badge: counts.upcomingBookings },
    { id: 'documents', label: 'Documents', ownerOnly: false, badge: 0 },
    { id: 'analytics', label: 'Analytics', ownerOnly: true, badge: 0 },
    { id: 'settings', label: 'Settings', ownerOnly: true, badge: 0 },
  ];

  const visibleTabs = allTabs.filter((t) => !t.ownerOnly || isOwner);

  const [activeTab, setActiveTab] = useState('community');

  return (
    <div>
      <TabBar tabs={visibleTabs} active={activeTab} onChange={setActiveTab} />

      {/* COMMUNITY — everything related to membership: people applying,
          people admins want to bring on, and people reaching out to us. */}
      {activeTab === 'community' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile
            href="/bananas/members"
            eyebrow="MANAGE"
            title="Members"
            count={counts.pastDueMembers}
          />
          <Tile
            href="/bananas/applications"
            eyebrow="REVIEW"
            title="Applications"
            count={counts.applications}
          />
          <Tile
            href="/bananas/collaborations"
            eyebrow="REVIEW"
            title="Collaborations"
            count={counts.collaborations}
          />
          <Tile
            href="/bananas/signups"
            eyebrow="VIEW"
            title="Signups"
            count={counts.newSignups}
          />
          <Tile
            href="/bananas/contacts"
            eyebrow="DIRECTORY"
            title="Contacts"
          />
          <Tile
            href="/bananas/guest-list"
            eyebrow="REPORTING"
            title="Guest List"
          />
          <Tile
            href="/bananas/pay-requests"
            eyebrow="REVIEW"
            title="Artist Pay"
            count={counts.pendingPayRequests}
          />
        </div>
      )}

      {/* RENTALS — Micro Parties and Venue Inquiries only. */}
      {activeTab === 'rentals' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile
            href="/bananas/venue-inquiries"
            eyebrow="REVIEW"
            title="Venue Inquiries"
            count={counts.venueInquiries}
          />
          <Tile
            href="/bananas/micro-parties"
            eyebrow="REVIEW"
            title="Micro Parties"
            count={counts.microParties}
          />
        </div>
      )}

      {/* STUDIO */}
      {activeTab === 'studio' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile
            href="/bananas/studio-bookings"
            eyebrow="MANAGE"
            title="Studio Bookings"
            count={counts.upcomingBookings}
          />
          <Tile
            href="/bananas/studio-settings"
            eyebrow="MANAGE"
            title="Studio Settings"
          />
        </div>
      )}

      {/* TEAM */}
      {activeTab === 'team' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/team/progress" eyebrow="TRACK" title="Tasks" />
          <Tile href="/team/calendar" eyebrow="TEAM ONLY" title="Team Calendar" />
          <Tile href="/team/chat" eyebrow="NEW" title="Team Chat" count={counts.unreadChat} />
        </div>
      )}

      {/* DOCUMENTS */}
      {activeTab === 'documents' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/bananas/documents" eyebrow="PRIVATE" title="Documents" />
        </div>
      )}

      {/* ANALYTICS — owner only */}
      {activeTab === 'analytics' && isOwner && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/bananas/financials" eyebrow="OWNER ONLY" title="Financials" />
          <Tile href="/bananas/cash-flow" eyebrow="OWNER ONLY" title="Cash Flow" />
          <Tile href="/capacity" eyebrow="LIVE" title="Capacity Counter" />
        </div>
      )}

      {/* SETTINGS — owner only */}
      {activeTab === 'settings' && isOwner && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/bananas/settings" eyebrow="MANAGE" title="Settings" />
          <Tile href="/bananas/team" eyebrow="MANAGE" title="Team Members" />
          <Tile href="/bananas/security" eyebrow="ACCOUNT" title="Security / MFA" />
        </div>
      )}
    </div>
  );
}
