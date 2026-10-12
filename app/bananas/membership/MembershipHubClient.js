'use client';

// Membership hub — tabbed view.
//
// Six lifecycle states as tabs:
//
//   Guest · Trial Ready · Trial Activated · The Weekender · The Builder · The Insider
//
// Each tab is a clean, scannable list of profiles currently in that state,
// with large square photos so faces are easy to recognise.
// No funnel chart, no timeseries, no KPI clutter. The counts on the tabs
// are the funnel. Selecting a tab reveals a search box, the tab's hint line,
// and the profile list; nothing else.
//
// Deliberately narrow: applications-in-review, past-due members, and
// cancelling members are the responsibility of the existing
// /bananas/applications and /bananas/members surfaces. This hub is
// "who is at each state right now".

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { ANALYTICS_THEMES, FINANCIAL_THEMES } from '@/lib/admin-theme';
import { centsToUsd } from '@/lib/event-analytics';
import UnderlineTabs from '../components/UnderlineTabs';
import cardStyles from '../applications/applications.module.css';
import styles from './membership.module.css';

const THEMES = {
  dark:  { ...ANALYTICS_THEMES.dark,  ...FINANCIAL_THEMES.dark },
  light: { ...ANALYTICS_THEMES.light, ...FINANCIAL_THEMES.light },
};

// -----------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtCents(cents) {
  if (cents === null || cents === undefined) return '—';
  return centsToUsd(cents);
}

// -----------------------------------------------------------------------
// Photo (photo or initials fallback) — a large square thumbnail at the start
// of each list row, sized so faces stay recognisable.
// -----------------------------------------------------------------------

function ProfilePhoto({ name, photoUrl, onPhotoError }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const initials = (name || '').trim().split(/\s+/).map((p) => p[0] || '').slice(0, 2).join('').toUpperCase() || '?';
  return (
    <div
      className={styles.photo}
      style={{ aspectRatio: '1 / 1' }}
    >
      {photoUrl && photoUrl !== failedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name || ''} loading="lazy" decoding="async" onError={() => { setFailedUrl(photoUrl); onPhotoError?.(); }} />
      ) : <span aria-hidden="true">{initials}</span>}
    </div>
  );
}

// -----------------------------------------------------------------------
// The one context line per row, chosen for the row's kind
// -----------------------------------------------------------------------

function contextLine(row) {
  if (row.kind === 'account') {
    const verified = row.phone_verified ? 'phone verified' : 'phone unverified';
    return `Signed up ${fmtDate(row.created_at)} · ${row.age_days}d ago · ${verified}`;
  }
  if (row.kind === 'trial') {
    if (row.visits > 0) return `Visited ${row.visits}× · last ${fmtWhen(row.last_visit)}`;
    if (row.activated_at) return `Activated ${fmtDate(row.activated_at)} · ${row.days_left}d left`;
    const activateHint = row.days_left != null ? ` · ${row.days_left}d to activate` : '';
    return `Issued ${fmtDate(row.issued_at)}${activateHint}`;
  }
  if (row.kind === 'member') {
    return `${fmtCents(row.monthly_cents)}/mo · member since ${fmtDate(row.member_since)}`;
  }
  return '';
}

// -----------------------------------------------------------------------
// Profile row — one large-thumbnail list row, shared by all six tabs.
// Only members have detail destinations; guests/trials remain read-only.
// -----------------------------------------------------------------------

function ProfileRow({ row, stageLabel, photoUrl, photoRef, onPhotoError }) {
  const name = row.full_name || row.email || 'Unnamed';
  const contextLabel = row.kind === 'account' ? 'Account'
    : row.kind === 'trial' ? 'Trial activity' : 'Membership';
  const inner = (
    <>
      <ProfilePhoto name={name} photoUrl={photoUrl} onPhotoError={onPhotoError} />
      <div className={styles.identity}>
        <div className={styles.stage}>{stageLabel}</div>
        <h2>{name}</h2>
        <div className={styles.context}>
          <span>{contextLabel}</span>
          <p>{contextLine(row)}</p>
        </div>
      </div>
      <dl className={styles.details}>
        <div><dt>Email</dt><dd>{row.email || 'Not provided'}</dd></div>
        <div><dt>Phone</dt><dd>{row.phone || 'Not provided'}</dd></div>
      </dl>
      <div className={styles.action}>
        {row.href ? (
          <span className={styles.open}>
            View member <span aria-hidden="true">↗</span>
          </span>
        ) : null}
      </div>
    </>
  );

  if (!row.href) return <li><article ref={photoRef} className={`${styles.row} ${styles.readOnly}`}>{inner}</article></li>;
  return (
    <li>
      <Link href={row.href} ref={photoRef} className={styles.row} aria-label={`View member ${name}`}>
        {inner}
      </Link>
    </li>
  );
}

// -----------------------------------------------------------------------
// The hub
// -----------------------------------------------------------------------

const DEFAULT_TAB = 'guest';

// Photo loading. The list endpoint returns only `has_photo`; signed URLs are
// requested in batches for cards that are on (or near) the screen. Links
// last five minutes, so a cached link is reused until shortly before expiry.
const PHOTO_BATCH_MAX = 200;
const PHOTO_BATCH_DELAY_MS = 50;
const PHOTO_EXPIRY_MARGIN_MS = 30 * 1000;
const PHOTO_PRELOAD_MARGIN = '800px 0px';

const photoKey = (row) => `${row.kind}:${row.id}`;

export default function MembershipHubClient() {
  const { theme: mode } = useAuthenticatedTheme();
  const theme = THEMES[mode] || THEMES.dark;

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [active, setActive]   = useState(DEFAULT_TAB);
  const [q, setQ]             = useState('');
  const [photos, setPhotos]   = useState({}); // key → { url, expiresAt }

  // Photo batching state lives in refs so the IntersectionObserver callback
  // and in-flight requests never see stale closures.
  const photosRef   = useRef(photos);
  const pendingRef  = useRef(new Set());
  const inflightRef = useRef(new Set());
  const timerRef    = useRef(null);
  const observerRef = useRef(null);
  const callbacksRef = useRef(new Map()); // key → { ref, onError }, stable per card
  useEffect(() => { photosRef.current = photos; }, [photos]);

  const flushPhotos = useCallback(function flush() {
    timerRef.current = null;
    const keys = [...pendingRef.current].slice(0, PHOTO_BATCH_MAX);
    if (keys.length === 0) return;
    for (const k of keys) { pendingRef.current.delete(k); inflightRef.current.add(k); }
    fetch('/api/admin/membership/journey/photos', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const expiresAt = json?.expires_at ? new Date(json.expires_at).getTime() : Date.now() + 5 * 60 * 1000;
        setPhotos((prev) => {
          const next = { ...prev };
          for (const k of keys) next[k] = { url: json?.photos?.[k] || null, expiresAt };
          return next;
        });
      })
      .catch(() => { /* Cards keep their initials; the next scroll or tab change retries. */ })
      .finally(() => {
        for (const k of keys) inflightRef.current.delete(k);
        if (pendingRef.current.size && !timerRef.current) {
          timerRef.current = window.setTimeout(flush, PHOTO_BATCH_DELAY_MS);
        }
      });
    if (pendingRef.current.size) timerRef.current = window.setTimeout(flush, PHOTO_BATCH_DELAY_MS);
  }, []);

  const requestPhotos = useCallback((keys) => {
    let added = false;
    const now = Date.now();
    for (const k of keys) {
      const cached = photosRef.current[k];
      const fresh = Boolean(cached) && cached.expiresAt - PHOTO_EXPIRY_MARGIN_MS > now;
      if (fresh || inflightRef.current.has(k) || pendingRef.current.has(k)) continue;
      pendingRef.current.add(k);
      added = true;
    }
    if (added && !timerRef.current) timerRef.current = window.setTimeout(flushPhotos, PHOTO_BATCH_DELAY_MS);
  }, [flushPhotos]);

  // One shared observer for every card. Created lazily inside ref callbacks,
  // which only run in the browser.
  const getObserver = useCallback(() => {
    if (!observerRef.current && typeof IntersectionObserver !== 'undefined') {
      observerRef.current = new IntersectionObserver((entries) => {
        const keys = [];
        for (const entry of entries) {
          if (entry.isIntersecting && entry.target.dataset.photoKey) keys.push(entry.target.dataset.photoKey);
        }
        if (keys.length) requestPhotos(keys);
      }, { rootMargin: PHOTO_PRELOAD_MARGIN });
    }
    return observerRef.current;
  }, [requestPhotos]);

  // Stable per-card callbacks, cached by key so photo updates re-render
  // cards without detaching and re-observing every one of them.
  //   ref     — observes the card; React 19 runs the returned cleanup on unmount.
  //   onError — an expired link (e.g. a card remounted after a tab switch) is
  //             re-signed; a fresh link that fails just shows initials.
  const callbacksFor = useCallback((key) => {
    let cb = callbacksRef.current.get(key);
    if (cb) return cb;
    cb = {
      ref: (el) => {
        if (!el) return undefined;
        const observer = getObserver();
        if (!observer) { requestPhotos([key]); return undefined; }
        el.dataset.photoKey = key;
        observer.observe(el);
        return () => observer.unobserve(el);
      },
      onError: () => {
        const entry = photosRef.current[key];
        if (entry && entry.expiresAt - PHOTO_EXPIRY_MARGIN_MS <= Date.now()) requestPhotos([key]);
      },
    };
    callbacksRef.current.set(key, cb);
    return cb;
  }, [getObserver, requestPhotos]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    observerRef.current?.disconnect();
    observerRef.current = null;
    timerRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = () => fetch('/api/admin/membership/journey', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => { if (!cancelled) { setPayload(json); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    load();
    // Keep the lists current while the page stays open. This refresh no
    // longer signs photos — those are requested per visible card and reused
    // until shortly before their five-minute expiry.
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    const timer = window.setInterval(refresh, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const tabOrder = payload?.tab_order || [];
  const tabMeta  = payload?.tab_meta  || {};
  const counts   = payload?.counts    || {};
  const mrrCents = payload?.mrr_cents || {};
  const activeMeta = tabMeta[active];

  // Memo the tab's rows so the search useMemo below has a stable input
  // even when `payload` re-renders unchanged.
  const rows = useMemo(() => payload?.tabs?.[active] || [], [payload, active]);

  // Client-side search across name + email + phone. Cheap because each tab
  // is bounded (a few thousand rows at most).
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) => {
      const hay = `${r.full_name || ''} ${r.email || ''} ${r.phone || ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [rows, q]);

  // Reset the search field whenever the active tab changes so a stale query
  // doesn't hide the newly-selected list.
  useEffect(() => { setQ(''); }, [active]);

  // MRR line only shown on paying-tier tabs.
  const showMrr = ['weekender', 'builder', 'insider'].includes(active);
  const activeMrr = mrrCents[active] || 0;

  return (
    <div className="space-y-6" style={{ color: theme.text }}>
      <div className={`${cardStyles.layout} max-w-[1200px] mx-auto`}>

        {/* Header */}
        <header className="mb-6">
          <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-1" style={{ color: theme.muted }}>
            Bananas · Membership
          </div>
          <h1
            className="text-[32px] font-semibold leading-none"
            style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.02em' }}
          >
            The Journey
          </h1>
          <p className="text-[13px] mt-2 max-w-[640px]" style={{ color: theme.muted }}>
            Every account by lifecycle state. Pick a tab; see the list.
          </p>
        </header>

        {error ? (
          <div
            className="rounded-[12px] border p-4 mb-4 text-[13px]"
            style={{ background: theme.cardBg, borderColor: theme.cardBorder, color: '#f87171' }}
          >
            Failed to load: {error}
          </div>
        ) : null}

        {/* Search sits above the tabs — matches the Contacts / Members pattern.
            The query filters within whichever tab is open, rather than being
            scoped to one of them. */}
        <input
          type="search"
          aria-label="Search name, email or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or phone"
          className="w-full max-w-[420px] mb-5 px-5 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30"
          style={{
            background: theme.neutralChipBg,
            borderColor: theme.cardBorder,
            color: theme.text,
          }}
        />

        {/* Tabs — shared UnderlineTabs so the strip matches every other in-page
            filter in the admin panel (Members, Applications, Pay Requests, etc). */}
        {tabOrder.length ? (
          <UnderlineTabs
            tabs={tabOrder.map((id) => ({
              id,
              label: tabMeta[id]?.label,
              count: counts?.[id] || 0,
              color: tabMeta[id]?.accent,
            }))}
            active={active}
            onChange={setActive}
            ariaLabel="Filter accounts by lifecycle state"
            testId="membership-journey"
            exactCounts
          />
        ) : null}

        {/* One-line context row: what this tab means, plus MRR on paying tiers.
            Kept intentionally quiet — no coloured panel bar, no card chrome. */}
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4 -mt-4">
          <div className="text-[13px]" style={{ color: theme.muted }}>
            {activeMeta?.hint}
          </div>
          {showMrr ? (
            <div className="text-[13px]" style={{ color: theme.mutedStrong }}>
              <span className="text-[11px] uppercase tracking-[0.14em] mr-2" style={{ color: theme.muted }}>
                Monthly recurring
              </span>
              <span className="font-semibold" style={{ color: theme.text }}>{fmtCents(activeMrr)}</span>
            </div>
          ) : null}
        </div>

        {/* Every tab uses the same large-thumbnail list rows. */}
        <div>
          {loading && !payload ? (
            <div className={cardStyles.empty} role="status">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className={cardStyles.empty} role="status">
              {rows.length === 0
                ? 'Nobody here right now.'
                : 'No matches for your search.'}
            </div>
          ) : (
            <ul className={styles.list} data-testid="membership-journey-list">
              {filtered.map((row) => (
                <ProfileRow
                  key={`${row.kind}-${row.id}`}
                  row={row}
                  stageLabel={activeMeta?.label}
                  photoUrl={row.has_photo ? photos[photoKey(row)]?.url || null : null}
                  photoRef={row.has_photo ? callbacksFor(photoKey(row)).ref : undefined}
                  onPhotoError={row.has_photo ? callbacksFor(photoKey(row)).onError : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
