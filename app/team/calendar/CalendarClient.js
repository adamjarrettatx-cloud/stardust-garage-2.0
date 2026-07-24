'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import TeamEventModal from '@/app/bananas/calendar/TeamEventModal';
import ThemeToggle from '@/app/components/ThemeToggle';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const THEME_KEY = 'sdg-admin-calendar-theme';

// Category config: label, swatch color, a darker variant for readable text on
// light backgrounds, and the text color used on a fully-filled chip (e.g. the
// category picker in the modal).
const CATEGORIES = {
  internal:      { label: 'Internal',      color: '#3b82f6', darkColor: '#1d4ed8', text: '#fff' },
  team_meeting:  { label: 'Team Meeting',  color: '#8b5cf6', darkColor: '#6d28d9', text: '#fff' },
  yoga:          { label: 'Yoga',          color: '#10b981', darkColor: '#047857', text: '#fff' },
  micro_party:   { label: 'Micro Party',   color: '#f59e0b', darkColor: '#92400e', text: '#000' },
  workshop:      { label: 'Workshop',      color: '#ec4899', darkColor: '#be185d', text: '#fff' },
  maintenance:   { label: 'Maintenance',   color: '#6b7280', darkColor: '#374151', text: '#fff' },
  other:         { label: 'Other',         color: '#f97316', darkColor: '#9a3412', text: '#fff' },
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

function eventStyle(evt, theme) {
  const map = evt?.visibility === 'internal' ? INTERNAL_STYLE : PUBLIC_STYLE;
  return map[theme];
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

// Unified Team Calendar. Admins get "+ Add Event" for every event, click any
// chip to edit, and a light/dark toggle (matching the admin dashboard's other
// pages). Team members keep the personalized, read-mostly view: they can add
// events and edit their own, but everyone else's team events render dimmed
// and non-interactive. The isAdmin flag is a UI convenience only — the actual
// dataset each role receives is already scoped server-side (page.js) / by RLS.
export default function CalendarClient({ publicEvents, teamEvents: initialTeamEvents, isAdmin, currentUserId, currentUserName }) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [teamEvents, setTeamEvents] = useState(initialTeamEvents);
  const [modalState, setModalState] = useState(null); // null | { mode:'create', date } | { mode:'edit', event }
  const [selectedDay, setSelectedDay] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [signingOut, setSigningOut] = useState(false);

  // Restore saved theme preference on mount (admin only — team members always
  // see the dark view, unchanged from before this page was unified).
  useEffect(() => {
    if (!isAdmin) return;
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // localStorage unavailable — fall back to default dark theme silently.
    }
  }, [isAdmin]);

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  };

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

  return (
    <main
      className="max-w-[1400px] mx-auto px-6 py-12 my-6 md:my-10 rounded-[28px] transition-colors duration-150"
      style={{
        background: t.panelBg || 'transparent',
        boxShadow: t.panelShadow,
        color: t.text,
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          {isAdmin && (
            <Link
              href="/bananas"
              className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-3 transition-opacity hover:opacity-70"
              style={{ color: t.muted }}
            >
              ← BACK TO ADMIN
            </Link>
          )}
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: t.textStrong }}
          >
            Team Calendar
          </h1>
          <p className="text-[14px] mt-1" style={{ color: t.muted }}>
            {isAdmin
              ? 'Click a day to view · double-click to add an event'
              : `Welcome, ${currentUserName} · click a day to view · double-click to add`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin ? (
            // Light / Dark theme toggle — scoped to this page only
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          ) : (
            <>
              <Link
                href="/team/chat"
                className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
                style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#ffb84d' }}
              >
                CHAT
              </Link>
              <Link
                href="/team/progress"
                className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
                style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#ffb84d' }}
              >
                PROGRESS
              </Link>
            </>
          )}
          <button
            onClick={() => setModalState({ mode: 'create', date: today })}
            className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
            style={{ background: t.addEventBg, color: t.addEventText }}
          >
            + ADD EVENT
          </button>
          {!isAdmin && (
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="px-4 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: 'rgba(255,255,255,0.15)', color: t.muted }}
            >
              {signingOut ? 'SIGNING OUT...' : 'SIGN OUT'}
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-6">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.1em]" style={{ color: t.muted }}>
          LEGEND:
        </span>
        <span className="flex items-center gap-1.5 text-[12px]">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PUBLIC_STYLE.dark.color, border: `1px solid ${PUBLIC_STYLE.dark.border}` }} />
          <span style={{ color: t.mutedStrong }}>Public Event</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px]">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: INTERNAL_STYLE.dark.color, border: `1px solid ${INTERNAL_STYLE.dark.border}` }} />
          <span style={{ color: t.mutedStrong }}>Micro Party (Internal)</span>
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
                      return (
                        <div
                          key={`pub-${evt.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] font-semibold px-1.5 py-1 rounded"
                          style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}
                          title={internal ? `${evt.title} (internal micro party)` : evt.title}
                        >
                          <div className="truncate">{internal ? '🔒' : '★'} {evt.title}</div>
                          {evt.event_time && (
                            <div className="text-[10px] font-normal opacity-90 truncate">{evt.event_time}</div>
                          )}
                        </div>
                      );
                    })}
                    {team.slice(0, 3 - Math.min(pub.length, 2)).map(evt => {
                      const cat = CATEGORIES[evt.category] || CATEGORIES.other;
                      const chipColor = catTextColor(cat, theme);
                      const mine = canEdit(evt);
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
                          title={!isAdmin && mine ? `${evt.title} (click to edit)` : evt.title}
                        >
                          <div className="truncate">{evt.title}</div>
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
                    return (
                      <div
                        key={evt.id}
                        className="rounded-[8px] p-3"
                        style={{ background: st.bg, border: `1px solid ${st.border}` }}
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-[14px] font-bold" style={{ color: st.color }}>{evt.title}</div>
                          {internal && (
                            <span
                              className="text-[10px] font-bold tracking-[0.1em] px-1.5 py-0.5 rounded-full uppercase"
                              style={{ background: st.color, color: theme === 'light' ? '#fff' : '#0a0a0a' }}
                            >
                              Internal
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
                <div className="text-[11px] font-semibold tracking-[0.12em] mb-2" style={{ color: t.muted }}>TEAM EVENTS</div>
                <div className="space-y-2">
                  {selectedEvents.team.map(evt => {
                    const cat = CATEGORIES[evt.category] || CATEGORIES.other;
                    const chipColor = catTextColor(cat, theme);
                    const mine = canEdit(evt);
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
                          <div className="text-[14px] font-bold" style={{ color: t.textStrong }}>{evt.title}</div>
                          {!isAdmin && mine && <span className="ml-auto text-[10px] font-semibold" style={{ color: cat.color }}>EDIT</span>}
                        </div>
                        <div className="text-[12px] font-semibold" style={{ color: chipColor }}>{cat.label}</div>
                        {(evt.start_time || evt.end_time) && (
                          <div className="text-[12px] mt-0.5" style={{ color: t.mutedStrong }}>
                            {evt.start_time}{evt.end_time ? ` – ${evt.end_time}` : ''}
                          </div>
                        )}
                        {evt.description && (
                          <div className="text-[12px] mt-1 line-clamp-2" style={{ color: t.muted }}>{evt.description}</div>
                        )}
                        {!isAdmin && !mine && (
                          <div className="text-[10px] mt-1" style={{ color: t.muted }}>Added by team</div>
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
              + ADD EVENT THIS DAY
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalState && (
        <TeamEventModal
          mode={modalState.mode}
          event={modalState.event}
          defaultDate={modalState.date}
          categories={CATEGORIES}
          theme={theme}
          onSave={handleModalSave}
          onSaveBatch={handleModalSaveBatch}
          onDelete={handleModalDelete}
          onClose={() => setModalState(null)}
        />
      )}
    </main>
  );
}
