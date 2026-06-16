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
        background: isHighlighted ? '#1f1c14' : '#141414',
        borderColor: isHighlighted ? 'rgba(255,200,80,0.25)' : 'rgba(255,255,255,0.05)',
      }}
    >
      <div
        className="text-[10px] font-semibold tracking-[0.14em] mb-1.5"
        style={{ color: '#8a8a8a' }}
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
            background: '#ffb84d',
            color: '#0a0a0a',
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
            className="px-4 py-2 rounded-full text-[12px] font-semibold tracking-[0.1em] transition-colors"
            style={{
              background: isActive ? '#ffb84d' : 'rgba(255,255,255,0.06)',
              color: isActive ? '#0a0a0a' : '#c0c0c0',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {tab.label}
            {tab.badge > 0 && (
              <span
                className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none"
                style={{
                  background: isActive ? 'rgba(0,0,0,0.25)' : '#ffb84d',
                  color: isActive ? '#0a0a0a' : '#0a0a0a',
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
  const submissionsBadge =
    counts.applications +
    counts.venueInquiries +
    counts.microParties +
    counts.collaborations;

  const allTabs = [
    { id: 'submissions', label: 'Submissions', ownerOnly: false, badge: submissionsBadge },
    { id: 'studio', label: 'Studio', ownerOnly: false, badge: counts.upcomingBookings },
    { id: 'team', label: 'Team', ownerOnly: false, badge: 0 },
    { id: 'documents', label: 'Documents', ownerOnly: true, badge: 0 },
    { id: 'analytics', label: 'Analytics', ownerOnly: true, badge: 0 },
    { id: 'settings', label: 'Settings', ownerOnly: true, badge: 0 },
  ];

  const visibleTabs = allTabs.filter((t) => !t.ownerOnly || isOwner);

  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.id || 'submissions');

  return (
    <div>
      <TabBar tabs={visibleTabs} active={activeTab} onChange={setActiveTab} />

      {/* SUBMISSIONS */}
      {activeTab === 'submissions' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile
            href="/admin/applications"
            eyebrow="REVIEW"
            title="Applications"
            count={counts.applications}
          />
          <Tile
            href="/admin/members"
            eyebrow="MANAGE"
            title="Members"
            count={counts.pastDueMembers}
          />
          <Tile
            href="/admin/venue-inquiries"
            eyebrow="REVIEW"
            title="Venue Inquiries"
            count={counts.venueInquiries}
          />
          <Tile
            href="/admin/micro-parties"
            eyebrow="REVIEW"
            title="Micro Parties"
            count={counts.microParties}
          />
          <Tile
            href="/admin/collaborations"
            eyebrow="REVIEW"
            title="Collaborations"
            count={counts.collaborations}
          />
          <Tile
            href="/admin/signups"
            eyebrow="VIEW"
            title="Signups"
            count={counts.recentSignups}
          />
        </div>
      )}

      {/* STUDIO */}
      {activeTab === 'studio' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile
            href="/admin/studio-bookings"
            eyebrow="MANAGE"
            title="Studio Bookings"
            count={counts.upcomingBookings}
          />
          <Tile
            href="/admin/studio-settings"
            eyebrow="MANAGE"
            title="Studio Settings"
          />
        </div>
      )}

      {/* TEAM */}
      {activeTab === 'team' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/admin/calendar" eyebrow="TEAM ONLY" title="Team Calendar" />
          <Tile href="/admin/team" eyebrow="MANAGE" title="Team Members" />
        </div>
      )}

      {/* DOCUMENTS — owner only */}
      {activeTab === 'documents' && isOwner && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/admin/documents" eyebrow="PRIVATE" title="Documents" />
        </div>
      )}

      {/* ANALYTICS — owner only */}
      {activeTab === 'analytics' && isOwner && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/admin/analytics" eyebrow="INSIGHTS" title="Event Analytics" />
          <Tile href="/capacity" eyebrow="LIVE" title="Capacity Counter" />
        </div>
      )}

      {/* SETTINGS — owner only */}
      {activeTab === 'settings' && isOwner && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Tile href="/admin/settings" eyebrow="MANAGE" title="Settings" />
          <Tile href="/admin/security" eyebrow="ACCOUNT" title="Security / MFA" />
        </div>
      )}
    </div>
  );
}
