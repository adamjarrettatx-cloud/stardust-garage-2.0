'use client';

import Link from 'next/link';
import {
  adminTabById,
  ADMIN_TILE_ACTIONS,
  ADMIN_TABS,
  adminTilesFor,
  adminTabBadge,
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
const ACTIONS = ADMIN_TILE_ACTIONS;

const RESTRICTION_LABELS = {
  owner: 'Owner only',
  team: 'Team only',
};

// ---------------------------------------------------------------------------
// Tile content
// ---------------------------------------------------------------------------
// The definitions themselves now live in lib/admin-tabs.js, because the
// persistent shell needs them too (it maps the current pathname back to a
// section so the sidebar can highlight where you are). Here we only bind the
// live counts onto them.
function tilesFor(counts = {}) {
  return Object.fromEntries(
    ADMIN_TABS.map((tab) => [
      tab.id,
      adminTilesFor(tab.id).map(({ countKey, ...tile }) => ({
        ...tile,
        count: countKey ? counts[countKey] || 0 : 0,
      })),
    ])
  );
}

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
// Tile grid
// ---------------------------------------------------------------------------
// Just the tile grid now. The sidebar moved to AdminShell so it can live in
// app/bananas/layout.js and survive navigation - clicking a tile swaps this
// panel for the destination page instead of replacing the whole screen, so
// there is no longer a full page to click back out of.
//
// `activeTab` is owned by the shell, which also owns the URL (?tab=) and the
// back/forward handling.
export default function AdminDashboardClient({ isOwner, counts, activeTab }) {
  const tiles = tilesFor(counts);
  const section = adminTabById(activeTab);
  const sectionTiles = tiles[activeTab] || [];

  // Belt and braces: the shell already resolves owner-only sections, but never
  // render owner tiles for a non-owner even if an unexpected id arrives here.
  const visibleTiles = isOwner
    ? sectionTiles
    : sectionTiles.filter((tile) => tile.restricted !== 'owner');

  return (
    <div id={`admin-panel-${activeTab}`}>
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
        {visibleTiles.map((tile) => (
          <Tile key={tile.href} {...tile} />
        ))}
      </div>
    </div>
  );
}

export { ACTIONS, tilesFor, badgeFor };
