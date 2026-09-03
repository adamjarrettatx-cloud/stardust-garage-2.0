'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { linkedEventHref } from '@/lib/linked-event-link';
import TeamEventModal from '@/app/bananas/calendar/TeamEventModal';
import AuthenticatedThemeToggleControl from '@/app/components/AuthenticatedThemeToggleControl';
import { useInAdminShell } from '@/app/components/AdminShellContext';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Category config: label, swatch color, a darker variant for readable text on
// light backgrounds, and the text color used on a fully-filled chip (e.g. the
// category picker in the modal).
const CATEGORIES = {
  internal:                  { label: 'Internal',                  color: '#3b82f6', darkColor: '#1d4ed8', text: '#fff' },
  team_meeting:              { label: 'Team Meeting',              color: '#8b5cf6', darkColor: '#6d28d9', text: '#fff' },
  yoga:                      { label: 'Yoga',                      color: '#10b981', darkColor: '#047857', text: '#fff' },
  yoga_residency:            { label: 'Yoga Residency',            color: '#14b8a6', darkColor: '#0f766e', text: '#fff' },
  evening_music_residency:   { label: 'Evening Music Residency',   color: '#a855f7', darkColor: '#7e22ce', text: '#fff' },
  day_party:                 { label: 'Day Party',                 color: '#f59e0b', darkColor: '#92400e', text: '#000' },
  trial_resident_party:      { label: 'Trial Resident Party',      color: '#e11d48', darkColor: '#9f1239', text: '#fff' },
  sdg_party:                 { label: 'SDG Party',                 color: '#dc2626', darkColor: '#991b1b', text: '#fff' },
  workshop:                  { label: 'Workshop',                  color: '#eab308', darkColor: '#a16207', text: '#000' },
};

// Neutral fallback used when an event has an unknown or removed category (e.g.
// legacy 'micro_party' or 'other' values that no longer exist in the legend).
// Keeps rendering safe until the event is re-tagged.
const FALLBACK_CATEGORY = {
  label: 'Uncategorized',
  color: '#9ca3af',
  darkColor: '#4b5563',
  text: '#fff',
};

// PUBLIC / INTERNAL micro-party marker styles, per theme. Light-mode text
// uses a deeper shade of the same hue so it stays readable on a white chip.
const PUBLIC_STYLE = {
  dark:  { color: '#ffb84d', bg: 'rgba(255,184,77,0.12)', border: 'rgba(255,184,77,0.3)' },
  light: { color: '#8a5109', bg: 'rgba(255,184,77,0.18)', border: 'rgba(184,120,20,0.4)' },
};
const INTERNAL_STYLE = {
  dark:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.4)' },
  light: { color: '#7c3d0a', bg: 'rgba(245,158,11,0.2)',  border: 'rgba(180,105,10,0.45)' },
};

// Full page theme palettes.
const THEMES = {
  dark: {
    panelBg: null, // no card wrapper — page sits directly on the cosmic backdrop
    panelShadow: 'none',
    text: '#f5f5f5',
    textStrong: '#ffffff',
    muted: '#8a8a8a',
    mutedStrong: '#aaaaaa',
    cellBg: '#141414',
    cellBgOutside: '#0f0f0f',
    gridLine: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.12)',
    borderSoft: 'rgba(255,255,255,0.08)',
    selectedBg: 'rgba(255,255,255,0.08)',
    selectedOutline: '1px solid rgba(255,255,255,0.2)',
    todayBg: '#ffffff',
    todayText: '#0a0a0a',
    dayNumOutside: '#333333',
    hoverBg: 'rgba(255,255,255,0.1)',
    addEventBg: '#ffffff',
    addEventText: '#0a0a0a',
    chipTintAlpha: '33',
    chipBorderAlpha: '44',
  },
  light: {
    panelBg: '#faf9f6',
    panelShadow: '0 24px 64px rgba(0,0,0,0.35)',
    text: '#1a1a1d',
    textStrong: '#000000',
    muted: '#5c5c63',
    mutedStrong: '#3a3a40',
    cellBg: '#ffffff',
    cellBgOutside: '#efece6',
    gridLine: 'rgba(0,0,0,0.08)',
    border: 'rgba(0,0,0,0.18)',
    borderSoft: 'rgba(0,0,0,0.12)',
    selectedBg: 'rgba(0,0,0,0.06)',
    selectedOutline: '1px solid rgba(0,0,0,0.2)',
    todayBg: '#1a1a1d',
    todayText: '#ffffff',
    dayNumOutside: '#c7c4bc',
    hoverBg: 'rgba(0,0,0,0.06)',
    addEventBg: '#1a1a1d',
    addEventText: '#ffffff',
    chipTintAlpha: '17',
    chipBorderAlpha: '55',
  },
};

// Public event tiles use their assigned category color (with a translucent
// fill so the tile still reads as a chip on both light and dark backgrounds).
// Internal micro-parties keep the amber INTERNAL_STYLE regardless of category
// so they stay visually distinct from public events. Anything without a known
// category falls back to the amber PUBLIC_STYLE.
function eventStyle(evt, theme) {
  if (evt?.visibility === 'internal') {
    return INTERNAL_STYLE[theme];
  }
  const cat = evt?.category ? CATEGORIES[evt.category] : null;
  if (!cat) {
    return PUBLIC_STYLE[theme];
  }
  // Alpha values chosen to match the internal-team-event chip translucency
  // used elsewhere on the calendar (see the team-event chip render for
  // comparison).
  const bgAlpha = theme === 'light' ? '22' : '2e';
  const borderAlpha = theme === 'light' ? '66' : '80';
  return {
    color: theme === 'light' ? cat.darkColor : cat.color,
    bg: `${cat.color}${bgAlpha}`,
    border: `${cat.color}${borderAlpha}`,
  };
}

function catTextColor(cat, theme) {
  return theme === 'light' ? cat.darkColor : cat.color;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function parseLocalDate(str) {
  // parse YYYY-MM-DD without timezone shifting
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// The Events Calendar — the venue's programming calendar. Everything we are
// doing or plan to do as a business, in calendar view: published website
// events (read-only here) plus internal entries the team adds themselves.
// It is not a rota; who is working when is not on it.
//
// It renders in two places from this one component:
//
//   variant="section" — at the top of the Events section of /bananas, sitting
//                       above the events list. The shell already supplies the
//                       page container, header and theme toggle.
//   variant="page"    — the standalone /team/calendar page a non-admin team
//                       member lands on, which brings its own chrome.
//
// Admins can add an entry on any day and click any chip to edit. Team members
// keep the personalized, read-mostly view: they can add entries and edit their
// own, but everyone else's render dimmed and non-interactive. The isAdmin flag
// is a UI convenience only — the dataset each role receives is already scoped
// server-side (lib/events-calendar-data.js) and by RLS.

// Contract-state stripe on public event tiles.
// - 'signed'   → green    (a signed or partially-signed contract exists)
// - 'progress' → yellow   (draft/sent/etc., nothing signed yet)
// - 'missing'  → red      (no contract row for this event)
// Internal micro-parties are excluded because they never have counterparties.
const CONTRACT_STRIPE = {
  signed:   '#22c55e',
  progress: '#eab308',
  missing:  '#dc2626',
};
const CONTRACT_STRIPE_LABEL = {
  signed:   'Contract signed',
  progress: 'Contract in progress',
  missing:  'Contract missing',
};

export default function EventsCalendarClient({ publicEvents, teamEvents: initialTeamEvents, publicEventContractStatus = {}, isAdmin, currentUserId, currentUserName, creatorNames = {}, chatUnreadCount = 0, variant = 'page' }) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date();
  const { theme, toggleTheme } = useAuthenticatedTheme();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [teamEvents, setTeamEvents] = useState(initialTeamEvents);
  const [modalState, setModalState] = useState(null); // null | { mode:'create', date } | { mode:'edit', event }
  const [selectedDay, setSelectedDay] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  const t = THEMES[theme];

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(null);
  };

  const getEventsForDate = useCallback((date) => {
    const pub = publicEvents.filter(e => isSameDay(parseLocalDate(e.event_date), date));
    const team = teamEvents.filter(e => isSameDay(parseLocalDate(e.event_date), date));
    return { pub, team };
  }, [publicEvents, teamEvents]);

  // Admins can edit any team event; team members can only edit their own.
  const canEdit = useCallback((evt) => isAdmin || evt.created_by === currentUserId, [isAdmin, currentUserId]);

  // Display name for whoever created a team event. Populated for every role
  // via the team_creator_names() RPC (see page.js) — falls back gracefully
  // if a lookup is somehow missing.
  const getCreatorName = useCallback(
    (evt) => creatorNames[evt.created_by] || (evt.created_by === currentUserId ? currentUserName : 'Unknown'),
    [creatorNames, currentUserId, currentUserName]
  );

  // Resolves a team event's optional link to a real site event. Returns null
  // when the linked event is missing from the caller's readable set.
  const getLinkedEvent = useCallback(
    (evt) => publicEvents.find(e => e.id === evt.linked_event_id) || null,
    [publicEvents]
  );

  // Monthly scorecard: who's added how many internal calendar entries in the
  // currently viewed month. Ranked descending so it reads like a leaderboard.
  const monthlyScorecard = useCallback(() => {
    const counts = {};
    teamEvents.forEach((evt) => {
      const d = parseLocalDate(evt.event_date);
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const name = getCreatorName(evt);
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [teamEvents, year, month, getCreatorName]);

  const handleDayClick = (date) => {
    setSelectedDay(date);
  };

  const handleDayDoubleClick = (date) => {
    setModalState({ mode: 'create', date });
  };

  const handleEventClick = (e, evt) => {
    e.stopPropagation();
    if (canEdit(evt)) {
      setModalState({ mode: 'edit', event: evt });
    }
  };

  const handleModalSave = (savedEvent) => {
    setTeamEvents(prev => {
      const idx = prev.findIndex(e => e.id === savedEvent.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = savedEvent;
        return updated;
      }
      return [...prev, savedEvent];
    });
    setModalState(null);
    router.refresh();
  };

  const handleModalSaveBatch = (savedEvents) => {
    setTeamEvents(prev => [...prev, ...savedEvents]);
    setModalState(null);
    router.refresh();
  };

  const handleModalDelete = (id, recurrenceId) => {
    setTeamEvents(prev =>
      recurrenceId
        ? prev.filter(e => e.recurrence_id !== recurrenceId)
        : prev.filter(e => e.id !== id)
    );
    setModalState(null);
    router.refresh();
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
  };

  // Selected day detail
  const selectedEvents = selectedDay ? getEventsForDate(selectedDay) : null;

  // Inside the admin shell the container, header and the way back already
  // exist; rendering our own would duplicate all three.
  const inShell = useInAdminShell();
  const Frame = inShell ? 'div' : 'main';

  // As a section of the Events tab the calendar carries no header of its own.
  // The tab already says "Events" and describes itself one line above, so a
  // second "Events Calendar" title, a second one-line description and an add
  // button sitting a few pixels from the list's "+ NEW EVENT" were all
  // duplicates. The section opens straight into the legend and the grid, and
  // closes with a rule that separates it from the list. Adding still works the
  // way it always has: double-click a day, or click one and use the day panel.
  const isSection = variant === 'section';

  return (
    <Frame
      className={inShell ? 'transition-colors duration-150' : 'px-6 py-12 transition-colors duration-150'}
      style={{ color: t.text }}
    >
      {/* Header — page variant only; see isSection above. */}
      {!isSection && (
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          {isAdmin && !inShell && (
            <Link
              href="/bananas"
              className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-3 transition-opacity hover:opacity-70"
              style={{ color: t.muted }}
            >
              ← BACK TO ADMIN
            </Link>
          )}
          <h1
            className={`font-extrabold -tracking-[0.02em] leading-[1.15] ${inShell ? 'text-[30px]' : 'text-[36px]'}`}
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
          >
            Events Calendar
          </h1>
          <p className="text-[14px] mt-1" style={{ color: t.muted }}>
            {isAdmin
              ? 'Everything on the books · click a day to view · double-click to add'
              : `Welcome, ${currentUserName} · click a day to view · double-click to add`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* The shell header already carries the theme toggle next to Log Out.
              Rendered only when this page supplies its own header instead — a
              non-admin team member never sees the shell. */}
          {!inShell && (
            <AuthenticatedThemeToggleControl theme={theme} onToggle={toggleTheme} />
          )}
          {isAdmin ? null : (
            <>
              <Link
                href="/team/chat"
                className="relative px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors"
                style={{ borderColor: 'var(--auth-ghost-border)', color: 'var(--auth-accent)' }}
              >
                CHAT
                {chatUnreadCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[10px] font-bold leading-none"
                    style={{ background: 'var(--auth-accent)', color: 'var(--auth-accent-text)' }}
                    aria-label={`${chatUnreadCount} unread messages`}
                  >
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </span>
                )}
              </Link>
              <Link
                href="/team/progress"
                className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors"
                style={{ borderColor: 'var(--auth-ghost-border)', color: 'var(--auth-accent)' }}
              >
                TASKS
              </Link>
              <Link
                href="/team/documents"
                className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors"
                style={{ borderColor: 'var(--auth-ghost-border)', color: 'var(--auth-accent)' }}
              >
                SOPS
              </Link>
            </>
          )}
          {!isAdmin && (
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="px-4 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors disabled:opacity-50"
              style={{ borderColor: 'var(--auth-ghost-border)', color: t.muted }}
            >
              {signingOut ? 'SIGNING OUT...' : 'SIGN OUT'}
            </button>
          )}
          <button
            onClick={() => setModalState({ mode: 'create', date: today })}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
            style={{ background: t.addEventBg, color: t.addEventText }}
          >
            + ADD TO CALENDAR
          </button>
        </div>
      </div>
      )}

      {/* Month nav */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={prevMonth}
          className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors text-[16px]"
          style={{ borderColor: t.border, color: t.text, background: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          ‹
        </button>
        <h2
          className="text-[22px] font-extrabold -tracking-[0.01em] min-w-[220px] text-center"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
        >
          {MONTHS[month]} {year}
        </h2>
        <button
          onClick={nextMonth}
          className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors text-[16px]"
          style={{ borderColor: t.border, color: t.text, background: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          ›
        </button>
        <button
          onClick={goToday}
          className="ml-2 px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-colors"
          style={{ borderColor: t.border, color: t.mutedStrong, background: 'transparent' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          TODAY
        </button>
      </div>

      <div className="flex gap-5">
        {/* Calendar Grid */}
        <div className="flex-1 min-w-0">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div
                key={d}
                className="text-center text-[12px] font-semibold tracking-[0.12em] py-2"
                style={{ color: t.muted }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid cells */}
          <div className="grid grid-cols-7 gap-px" style={{ background: t.gridLine }}>
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - firstDay + 1;
              const isCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
              const cellDate = new Date(year, month, dayNum);
              const isToday = isCurrentMonth && isSameDay(cellDate, today);
              const isSelected = selectedDay && isCurrentMonth && isSameDay(cellDate, selectedDay);
              const { pub, team } = isCurrentMonth ? getEventsForDate(cellDate) : { pub: [], team: [] };
              const hasEvents = pub.length + team.length > 0;

              return (
                <div
                  key={i}
                  onClick={() => isCurrentMonth && handleDayClick(cellDate)}
                  onDoubleClick={() => isCurrentMonth && handleDayDoubleClick(cellDate)}
                  className="min-h-[108px] p-2 cursor-pointer transition-colors"
                  style={{
                    background: isSelected
                      ? t.selectedBg
                      : isCurrentMonth ? t.cellBg : t.cellBgOutside,
                    outline: isSelected ? t.selectedOutline : 'none',
                  }}
                >
                  {/* Date number */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-[14px] font-bold w-7 h-7 flex items-center justify-center rounded-full"
                      style={{
                        background: isToday ? t.todayBg : 'transparent',
                        color: isToday ? t.todayText : isCurrentMonth ? t.text : t.dayNumOutside,
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      {isCurrentMonth ? dayNum : ''}
                    </span>
                    {hasEvents && !isCurrentMonth && null}
                  </div>

                  {/* Events */}
                  <div className="space-y-1">
                    {pub.slice(0, 2).map(evt => {
                      const st = eventStyle(evt, theme);
                      const internal = evt.visibility === 'internal';
                      // Contract stripe applies only to public events; internal
                      // micro-parties never have counterparties, so no stripe.
                      // Non-admins receive an empty publicEventContractStatus map
                      // (RLS-scoped server-side), which correctly short-circuits
                      // to no stripe rather than "everything looks missing".
                      const hasContractData = Object.keys(publicEventContractStatus).length > 0;
                      const contractState = !internal && hasContractData
                        ? (publicEventContractStatus[evt.id] || 'missing')
                        : null;
                      const stripeColor = contractState ? CONTRACT_STRIPE[contractState] : null;
                      const stripeLabel = contractState ? CONTRACT_STRIPE_LABEL[contractState] : null;
                      return (
                        <div
                          key={`pub-${evt.id}`}
                          onClick={(e) => {
                            // Clicking a public-event tile should open the
                            // day-detail side panel (same as clicking the
                            // cell), which is where the event's full info
                            // and admin edit link live.
                            e.stopPropagation();
                            if (isCurrentMonth) handleDayClick(cellDate);
                          }}
                          className="text-[11px] font-semibold pl-2 pr-1.5 py-1 rounded cursor-pointer relative overflow-hidden"
                          style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}
                          title={internal
                            ? `${evt.title} (internal micro party)`
                            : `${evt.title} \u2014 ${stripeLabel}`}
                        >
                          {stripeColor && (
                            <span
                              aria-hidden="true"
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: 3,
                                background: stripeColor,
                              }}
                            />
                          )}
                          <div className="truncate">{internal ? '🔒' : '★'} {evt.title}</div>
                          {evt.event_time && (
                            <div className="text-[10px] font-normal opacity-90 truncate">{evt.event_time}</div>
                          )}
                        </div>
                      );
                    })}
                    {team.slice(0, 3 - Math.min(pub.length, 2)).map(evt => {
                      const cat = CATEGORIES[evt.category] || FALLBACK_CATEGORY;
                      const chipColor = catTextColor(cat, theme);
                      const mine = canEdit(evt);
                      const linked = getLinkedEvent(evt);
                      const linkedHref = linkedEventHref(linked, isAdmin);
                      const chipTitle = isAdmin
                        ? `${evt.title} — created by ${getCreatorName(evt)}`
                        : mine
                          ? `${evt.title} (click to edit)`
                          : evt.title;
                      return (
                        <div
                          key={`team-${evt.id}`}
                          onClick={(e) => handleEventClick(e, evt)}
                          className="text-[11px] font-semibold px-1.5 py-1 rounded transition-opacity"
                          style={{
                            background: cat.color + t.chipTintAlpha,
                            color: chipColor,
                            border: `1px solid ${cat.color}${t.chipBorderAlpha}`,
                            cursor: mine ? 'pointer' : 'default',
                            opacity: mine ? 1 : 0.7,
                          }}
                          title={linked ? `${chipTitle} \u00b7 linked to ${linked.title}` : chipTitle}
                        >
                          <div className="truncate">
                            {linkedHref ? (
                              <Link
                                href={linkedHref}
                                onClick={(e) => e.stopPropagation()}
                                className="underline-offset-2 hover:underline"
                                title={`Open ${linked.title}`}
                                aria-label={`Open linked event ${linked.title}`}
                              >
                                {'\ud83d\udd17'}
                              </Link>
                            ) : evt.linked_event_id ? '\ud83d\udd17' : null}
                            {evt.linked_event_id ? ' ' : ''}{evt.title}
                          </div>
                          {evt.start_time && (
                            <div className="text-[10px] font-normal opacity-90 truncate">
                              {evt.start_time}{evt.end_time ? ` – ${evt.end_time}` : ''}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(pub.length + team.length) > 3 && (
                      <div className="text-[10px] font-semibold" style={{ color: t.muted }}>
                        +{pub.length + team.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Day Detail Panel */}
        {selectedDay && (
          <div
            className="w-[300px] flex-shrink-0 rounded-[14px] border p-5 self-start sticky top-6"
            style={{ background: t.cellBg, borderColor: t.borderSoft }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-[17px] font-bold"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
              >
                {selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-[18px] leading-none transition-opacity hover:opacity-50"
                style={{ color: t.muted }}
              >
                ×
              </button>
            </div>

            {selectedEvents.pub.length === 0 && selectedEvents.team.length === 0 && (
              <p className="text-[13px]" style={{ color: t.muted }}>No events this day.</p>
            )}

            {selectedEvents.pub.length > 0 && (
              <div className="mb-4">
                <div className="text-[11px] font-semibold tracking-[0.12em] mb-2" style={{ color: t.muted }}>WEBSITE EVENTS</div>
                <div className="space-y-2">
                  {selectedEvents.pub.map(evt => {
                    const st = eventStyle(evt, theme);
                    const internal = evt.visibility === 'internal';
                    const hasContractData = Object.keys(publicEventContractStatus).length > 0;
                    const contractState = !internal && hasContractData
                      ? (publicEventContractStatus[evt.id] || 'missing')
                      : null;
                    const contractColor = contractState ? CONTRACT_STRIPE[contractState] : null;
                    const contractLabel = contractState ? CONTRACT_STRIPE_LABEL[contractState] : null;
                    return (
                      <div
                        key={evt.id}
                        className="rounded-[8px] p-3 relative overflow-hidden"
                        style={{ background: st.bg, border: `1px solid ${st.border}` }}
                      >
                        {contractColor && (
                          <span
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: 3,
                              background: contractColor,
                            }}
                          />
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-[14px] font-bold" style={{ color: st.color }}>{evt.title}</div>
                          {internal && (
                            <span
                              className="text-[10px] font-bold tracking-[0.1em] px-1.5 py-0.5 rounded-full uppercase"
                              style={{ background: st.color, color: theme === 'light' ? '#fff' : '#0a0a0a' }}
                            >
                              Internal
                            </span>
                          )}
                          {contractColor && (
                            <span
                              className="text-[10px] font-semibold tracking-[0.05em] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                              style={{ background: `${contractColor}22`, color: contractColor, border: `1px solid ${contractColor}55` }}
                              title={contractLabel}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: 999, background: contractColor, display: 'inline-block' }} />
                              {contractLabel}
                            </span>
                          )}
                        </div>
                        {evt.event_time && <div className="text-[12px] mt-0.5" style={{ color: t.mutedStrong }}>{evt.event_time}</div>}
                        {isAdmin && (
                          <Link
                            href={`/bananas/events/${evt.id}`}
                            className="text-[11px] mt-1 inline-block underline-offset-2 hover:underline"
                            style={{ color: t.muted }}
                          >
                            Edit →
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedEvents.team.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold tracking-[0.12em] mb-2" style={{ color: t.muted }}>INTERNAL EVENTS</div>
                <div className="space-y-2">
                  {selectedEvents.team.map(evt => {
                    const cat = CATEGORIES[evt.category] || FALLBACK_CATEGORY;
                    const chipColor = catTextColor(cat, theme);
                    const mine = canEdit(evt);
                    const linked = getLinkedEvent(evt);
                    const linkedHref = linkedEventHref(linked, isAdmin);
                    return (
                      <div
                        key={evt.id}
                        className="rounded-[8px] p-3 transition-opacity"
                        style={{
                          background: cat.color + (theme === 'light' ? '14' : '22'),
                          border: `1px solid ${cat.color}${t.chipBorderAlpha}`,
                          cursor: mine ? 'pointer' : 'default',
                        }}
                        onClick={() => mine && setModalState({ mode: 'edit', event: evt })}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                          <div className="text-[14px] font-bold" style={{ color: t.textStrong }}>
                            {evt.linked_event_id ? '🔗 ' : ''}{evt.title}
                          </div>
                          {!isAdmin && mine && <span className="ml-auto text-[10px] font-semibold" style={{ color: cat.color }}>EDIT</span>}
                        </div>
                        <div className="text-[12px] font-semibold" style={{ color: chipColor }}>{cat.label}</div>
                        {isAdmin && (
                          <div className="text-[11px] mt-0.5" style={{ color: t.muted }}>Created by {getCreatorName(evt)}</div>
                        )}
                        {(evt.start_time || evt.end_time) && (
                          <div className="text-[12px] mt-0.5" style={{ color: t.mutedStrong }}>
                            {evt.start_time}{evt.end_time ? ` – ${evt.end_time}` : ''}
                          </div>
                        )}
                        {evt.description && (
                          <div className="text-[12px] mt-1 line-clamp-2" style={{ color: t.muted }}>{evt.description}</div>
                        )}
                        {linked && (
                          linkedHref ? (
                            <Link
                              href={linkedHref}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] mt-1 inline-block underline-offset-2 hover:underline"
                              style={{ color: t.muted }}
                            >
                              Linked: {linked.title} →
                            </Link>
                          ) : (
                            <div className="text-[11px] mt-1 truncate" style={{ color: t.muted }}>
                              Linked: {linked.title}
                            </div>
                          )
                        )}
                        {!isAdmin && !mine && (
                          <div className="text-[10px] mt-1" style={{ color: t.muted }}>Added by a teammate</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={() => setModalState({ mode: 'create', date: selectedDay })}
              className="w-full mt-4 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-colors"
              style={{ borderColor: t.border, color: t.text, background: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              + ADD TO THIS DAY
            </button>
          </div>
        )}
      </div>

      {/* Legend and the monthly scorecard read as a summary of the grid rather
          than a preamble to it, so they follow it. */}
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-8 mb-2">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.1em]" style={{ color: t.muted }}>
          LEGEND:
        </span>
        {Object.entries(CATEGORIES).map(([key, cat]) => (
          <span key={key} className="flex items-center gap-1.5 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: cat.color }} />
            <span style={{ color: t.mutedStrong }}>{cat.label}</span>
          </span>
        ))}
        {!isAdmin && (
          <span className="flex items-center gap-1.5 text-[12px] ml-auto">
            <span className="w-2.5 h-2.5 rounded-full border" style={{ borderColor: t.border }} />
            <span style={{ color: t.muted }}>Tap your own events to edit</span>
          </span>
        )}
      </div>
      {/* Contract stripe key — the coloured left-edge stripe on each public
          event tile shows whether that event has a signed contract yet.
          Only rendered when the current viewer actually receives contract
          data (admins), matching the stripe visibility on the tiles. */}
      {Object.keys(publicEventContractStatus).length > 0 && (
        <div className="flex flex-wrap gap-3 mb-5">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.1em]" style={{ color: t.muted }}>
            CONTRACT:
          </span>
          {['signed', 'progress', 'missing'].map((key) => (
            <span key={key} className="flex items-center gap-1.5 text-[12px]">
              <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 1, background: CONTRACT_STRIPE[key] }} />
              <span style={{ color: t.mutedStrong }}>{CONTRACT_STRIPE_LABEL[key]}</span>
            </span>
          ))}
        </div>
      )}

      {/* Monthly Scorecard — visible to the whole team, tracks who's creating events */}
      <div
        className="rounded-[14px] border p-4"
        style={{ background: t.cellBg, borderColor: t.borderSoft }}
      >
        <div className="text-[11px] font-semibold tracking-[0.14em] mb-3" style={{ color: t.muted }}>
          EVENTS CREATED — {MONTHS[month].toUpperCase()} {year}
        </div>
        {monthlyScorecard().length === 0 ? (
          <p className="text-[13px]" style={{ color: t.muted }}>No calendar entries added this month yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {monthlyScorecard().map(([name, count], idx) => (
              <div
                key={name}
                className="flex items-center gap-2 px-4 py-2 rounded-full border"
                style={{
                  borderColor: idx === 0 ? 'rgba(139,92,246,0.5)' : t.border,
                  background: idx === 0 ? 'rgba(139,92,246,0.12)' : 'transparent',
                }}
              >
                <span className="text-[13px] font-semibold" style={{ color: t.textStrong }}>{name}</span>
                <span
                  className="text-[13px] font-extrabold min-w-[20px] text-center"
                  style={{ color: idx === 0 ? '#8b5cf6' : t.mutedStrong }}
                >
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Above the events list, the calendar needs a visible end so the two
          don't read as one continuous block. */}
      {isSection && (
        <hr className="mt-10 mb-8 border-0 border-t" style={{ borderColor: t.borderSoft }} />
      )}

      {/* Modal */}
      {modalState && (
        <TeamEventModal
          mode={modalState.mode}
          event={modalState.event}
          defaultDate={modalState.date}
          categories={CATEGORIES}
          publicEvents={publicEvents}
          isAdmin={isAdmin}
          theme={theme}
          onSave={handleModalSave}
          onSaveBatch={handleModalSaveBatch}
          onDelete={handleModalDelete}
          onClose={() => setModalState(null)}
        />
      )}
    </Frame>
  );
}
