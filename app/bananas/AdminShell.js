'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  visibleAdminTabGroups,
  adminTabBadges,
  tabForPath,
  tileForPath,
  DEFAULT_ADMIN_TAB,
  resolveAdminTab,
  isShellExempt,
} from '@/lib/admin-tabs';
import AdminDashboardClient from './AdminDashboardClient';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import LogoutButton from './components/LogoutButton';
import { AdminShellProvider } from '@/app/components/AdminShellContext';

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
// Rendered once by app/bananas/layout.js, so it survives navigation between
// admin pages instead of being torn down and rebuilt. That is the whole point
// of the shell: opening Contacts no longer replaces the whole screen, so there
// is nothing to "click back out of" — the sidebar is still sitting there.
//
// Sections are real links, not buttons, for the same reason the dashboard tabs
// became URL-addressable: every destination should be bookmarkable, shareable
// and reachable with browser back/forward.
function Sidebar({ groups, activeTab, badges, isDashboardRoot, onSelect }) {
  return (
    <nav
      className="flex gap-2 overflow-x-auto pb-1.5 lg:block lg:overflow-visible lg:pb-0 lg:sticky lg:top-6"
      aria-label="Admin sections"
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
            const isActive = tab.id === activeTab;
            const badge = badges[tab.id] || 0;
            // On the dashboard root, switching sections is a local state change
            // plus a pushState - a full navigation would re-run all ten count
            // queries in the layout just to swap out a tile grid. Anywhere else
            // it stays a real link, so we genuinely navigate back to the
            // dashboard and land on the right section.
            return (
              <Link
                key={tab.id}
                href={`/bananas?tab=${tab.id}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={
                  isDashboardRoot
                    ? (event) => {
                        event.preventDefault();
                        onSelect(tab.id);
                      }
                    : undefined
                }
                className="shrink-0 lg:w-full flex items-center justify-between gap-2.5 text-left text-[15.5px] font-semibold -tracking-[0.01em] px-3 py-[11px] rounded-[10px] transition-colors whitespace-nowrap lg:whitespace-normal"
                style={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  background: isActive ? 'var(--auth-card-bg)' : 'transparent',
                  color: isActive ? 'var(--auth-text)' : 'var(--auth-muted)',
                  fontWeight: isActive ? 700 : 600,
                  boxShadow: isActive
                    ? 'inset 3px 0 0 var(--auth-accent), 0 1px 2px rgba(0,0,0,0.06)'
                    : 'none',
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
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------
// Shown only on a page inside a section, never on the dashboard root. It names
// the section you came from and links back to it, so the trail out is explicit
// even though browser back also works.
function SectionTrail({ sectionLabel, sectionTabId, pageTitle }) {
  return (
    <div
      className="flex items-center gap-2 mb-3 text-[13px] font-semibold"
      style={{ color: 'var(--auth-muted)' }}
    >
      <Link
        href={`/bananas?tab=${sectionTabId}`}
        className="inline-flex items-center gap-1.5 transition-colors hover:underline"
        style={{ color: 'var(--auth-muted)' }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {sectionLabel}
      </Link>
      {pageTitle && (
        <>
          <span aria-hidden="true" style={{ opacity: 0.5 }}>
            /
          </span>
          <span style={{ color: 'var(--auth-text)' }}>{pageTitle}</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
// `tileRequired` is set by the /team layout. Those routes are shared with
// non-admin team members and include pages with no tile at all (the SOP
// library, the trial-pass tools, the login screen), so the shell must only
// take over when the pathname actually belongs to a section. Under /bananas it
// always applies.
export default function AdminShell({
  userEmail,
  isOwner,
  counts,
  tileRequired = false,
  children,
}) {
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const groups = visibleAdminTabGroups(isOwner);
  const badges = useMemo(() => adminTabBadges(counts), [counts]);

  const isDashboardRoot = pathname === '/bananas' || pathname === '/bananas/';

  // Which section the tile grid is showing while we are on the dashboard root.
  // Seeded from ?tab= so a deep link such as /bananas?tab=people opens People.
  const [rootTab, setRootTab] = useState(() =>
    resolveAdminTab(searchParams?.get('tab'), { isOwner })
  );

  // If ?tab= changes underneath us - a link from elsewhere in the app, or
  // browser back/forward - follow it.
  const queryTab = searchParams?.get('tab');
  useEffect(() => {
    setRootTab(resolveAdminTab(queryTab, { isOwner }));
  }, [queryTab, isOwner]);

  const selectRootTab = useCallback(
    (id) => {
      const next = resolveAdminTab(id, { isOwner });
      setRootTab(next);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.pushState(null, '', url);
    },
    [isOwner]
  );

  // On the dashboard root the active section is whichever tile grid is showing.
  // On any other admin route it comes from the pathname, so opening Contacts
  // keeps People highlighted.
  const pathTab = tabForPath(pathname);
  const activeTab = isDashboardRoot
    ? rootTab
    : resolveAdminTab(pathTab || DEFAULT_ADMIN_TAB, { isOwner });

  const tile = isDashboardRoot ? null : tileForPath(pathname);
  const section = groups.flatMap((g) => g.tabs).find((t) => t.id === activeTab);

  // Nothing here belongs to a section, so leave the page exactly as it would
  // render on its own rather than framing an unrelated screen in admin chrome.
  // isShellExempt covers the inverse case: a route that does own a tile but
  // still supplies its own header and page container, so wrapping it would
  // double both.
  if (tileRequired && (!tile || isShellExempt(pathname))) return children;

  return (
    <AdminShellProvider>
    <main className="max-w-[1320px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        title="Admin"
        description={userEmail ? `Signed in as ${userEmail}` : null}
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      >
        <LogoutButton />
      </AuthenticatedPageHeader>

      <div className="lg:grid lg:grid-cols-[232px_1fr] lg:gap-9 lg:items-start">
      <Sidebar
        groups={groups}
        activeTab={activeTab}
        badges={badges}
        isDashboardRoot={isDashboardRoot}
        onSelect={selectRootTab}
      />

      <div className="mt-6 lg:mt-0 min-w-0">
        {tile && section && (
          <SectionTrail
            sectionLabel={section.label}
            sectionTabId={section.id}
            pageTitle={tile.title}
          />
        )}

        {/* The tile grid belongs to the shell rather than page.js so the counts
            behind its badges are fetched once in the layout instead of again
            per page. On the dashboard root, page.js contributes the EVENTS
            list below the grid. */}
        {isDashboardRoot && (
          <AdminDashboardClient
            isOwner={isOwner}
            counts={counts}
            activeTab={rootTab}
          />
        )}

        {children}
      </div>
      </div>
    </main>
    </AdminShellProvider>
  );
}
