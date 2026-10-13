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
        // `counted` separates "this row tracks a queue that is empty right
        // now" (Up to date) from "this row never carries a count" (no status).
        counted: Boolean(countKey),
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
// One quiet line glyph per row so the list scans by shape as well as by word.
// Keys are declared on each tile in lib/admin-tabs.js (`icon`).
const ICON_PATHS = {
  link: <><circle cx="9" cy="12" r="5" /><circle cx="15" cy="12" r="5" /></>,
  mail: <><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></>,
  building: <><path d="M4 20V8l8-4 8 4v12" /><path d="M9 20v-5h6v5" /></>,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  'file-check': <><path d="M6 3h9l3 3v15H6z" /><path d="m9 14 2 2 4-4" /></>,
  file: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 12h6M9 16h6" /></>,
  users: <><circle cx="9" cy="9" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3 3 3 6" /></>,
  ticket: <><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" /><path d="M14 7v10" /></>,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  flow: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  percent: <><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /></>,
  gauge: <><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 16 4-5" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  shield: <path d="M12 3 5 6v6c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6z" />,
};

function RowIcon({ name }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name] || ICON_PATHS.file}
    </svg>
  );
}

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

function Chevron() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 transition-transform group-hover:translate-x-0.5"
      style={{ color: 'var(--auth-faint)' }}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------
// Owner feedback 2026-10-12: the card grid spent most of its area on padding,
// and an odd tile count left a dead slot. Each destination is now one row in a
// single list. A row with queued work gets an accent edge, an accent icon and a
// count pill instead of a full-card wash, so attention lands on the number.
//
// Columns: icon | title + subtitle | action eyebrow | status | chevron.
// Status is one of: count pill, "Up to date" (counted queue at zero), the
// restriction lock, the status tag, or nothing.
function Row({ href, icon, action, title, sub, count = 0, counted, countLabel = 'new', restricted, status }) {
  const isHighlighted = count > 0;

  let statusNode = null;
  if (isHighlighted) {
    statusNode = (
      <span
        className="inline-flex items-center h-[24px] px-[10px] rounded-[6px] text-[12.5px] font-bold leading-none whitespace-nowrap"
        style={{ background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' }}
        aria-label={`${count} ${countLabel}`}
      >
        {count > 99 ? '99+' : count} {countLabel}
      </span>
    );
  } else if (status) {
    statusNode = (
      <span
        className="text-[10.5px] font-bold tracking-[0.1em] px-[7px] py-[4px] rounded-[5px] leading-none"
        style={{
          background: 'var(--auth-ghost-bg)',
          color: 'var(--auth-muted)',
          border: '1px solid var(--auth-ghost-border)',
        }}
      >
        {status}
      </span>
    );
  } else if (restricted) {
    statusNode = (
      <span className="inline-flex items-center gap-[6px] text-[12.5px] font-semibold whitespace-nowrap">
        <LockIcon />
        {RESTRICTION_LABELS[restricted]}
      </span>
    );
  } else if (counted) {
    statusNode = <span className="text-[12.5px] font-semibold whitespace-nowrap">Up to date</span>;
  }

  return (
    <Link
      href={href}
      className="group relative grid grid-cols-[36px_minmax(0,1fr)_auto_15px] sm:grid-cols-[36px_minmax(0,1fr)_76px_minmax(96px,auto)_15px] items-center gap-3 sm:gap-4 pl-3.5 pr-4 py-3 transition-colors hover:bg-[var(--auth-hover-bg)] focus-visible:outline-none focus-visible:bg-[var(--auth-hover-bg)]"
    >
      {isHighlighted && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-[3px]"
          style={{ background: 'var(--auth-accent)' }}
        />
      )}

      <span
        className="w-9 h-9 rounded-[10px] grid place-items-center"
        style={{
          background: isHighlighted ? 'var(--auth-warn-bg)' : 'var(--auth-card-bg-alt)',
          color: isHighlighted ? 'var(--auth-accent-strong)' : 'var(--auth-muted)',
        }}
      >
        <RowIcon name={icon} />
      </span>

      <span className="min-w-0 flex flex-col sm:flex-row sm:items-baseline gap-x-3 gap-y-[2px]">
        <span
          className="text-[15.5px] font-bold -tracking-[0.015em] whitespace-nowrap"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {title}
        </span>
        {sub && (
          <span
            className="text-[13.5px] leading-[1.45] truncate"
            style={{ color: 'var(--auth-muted)' }}
          >
            {sub}
          </span>
        )}
      </span>

      <span
        className="hidden sm:block text-[11px] font-bold tracking-[0.12em]"
        style={{ color: 'var(--auth-faint)' }}
      >
        {action}
      </span>

      <span className="justify-self-end flex items-center" style={{ color: 'var(--auth-faint)' }}>
        {statusNode}
      </span>

      <Chevron />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section list
// ---------------------------------------------------------------------------
// The sidebar lives in AdminShell (app/bananas/layout.js) and survives
// navigation - clicking a row swaps this panel for the destination page.
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

  const hasCounts = visibleTiles.some((t) => t.counted);
  const waiting = visibleTiles.reduce((sum, t) => sum + (t.count || 0), 0);

  return (
    <div id={`admin-panel-${activeTab}`} className="max-w-[1080px]">
      {/* A list needs a heading to say what the rows are for. Sections
          that render their own content do not: Events opens on the calendar
          and the events list, both of which announce themselves, under a
          sidebar entry already reading "Events" — so the heading and its
          description were a third label for the same thing. */}
      {section && !section.rendersOwnContent && (
        <div className="flex items-end justify-between gap-4 mb-[14px]">
          <div className="min-w-0">
            <h2
              className="text-[23px] font-bold -tracking-[0.02em] mb-[4px]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {section.label}
            </h2>
            <p
              className="text-[14.5px] leading-[1.5]"
              style={{ color: 'var(--auth-muted)' }}
            >
              {section.description}
            </p>
          </div>
          {hasCounts && (
            <div
              className="shrink-0 flex items-center gap-2 text-[13px] font-semibold pb-[3px] whitespace-nowrap"
              style={{ color: 'var(--auth-muted)' }}
            >
              {waiting > 0 && (
                <span
                  aria-hidden="true"
                  className="w-[7px] h-[7px] rounded-full"
                  style={{ background: 'var(--auth-accent)' }}
                />
              )}
              {waiting > 0 ? `${waiting} waiting on you` : 'All caught up'}
            </div>
          )}
        </div>
      )}

      {visibleTiles.length > 0 && (
        <div
          className="rounded-[14px] border overflow-hidden"
          style={{
            background: 'var(--auth-card-bg)',
            borderColor: 'var(--auth-card-border)',
          }}
        >
          {visibleTiles.map((tile, i) => (
            <div
              key={tile.href}
              style={i > 0 ? { borderTop: '1px solid var(--auth-row-border)' } : undefined}
            >
              <Row {...tile} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { ACTIONS, tilesFor, badgeFor };
