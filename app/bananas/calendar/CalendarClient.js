'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TeamEventModal from './TeamEventModal';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Category config: label, color (bg), text color
const CATEGORIES = {
  internal:      { label: 'Internal',      color: '#3b82f6', text: '#fff' },
  team_meeting:  { label: 'Team Meeting',  color: '#8b5cf6', text: '#fff' },
  yoga:          { label: 'Yoga',          color: '#10b981', text: '#fff' },
  micro_party:   { label: 'Micro Party',   color: '#f59e0b', text: '#000' },
  workshop:      { label: 'Workshop',      color: '#ec4899', text: '#fff' },
  maintenance:   { label: 'Maintenance',   color: '#6b7280', text: '#fff' },
  other:         { label: 'Other',         color: '#f97316', text: '#fff' },
};

// PUBLIC event marker style
const PUBLIC_STYLE = { color: '#ffb84d', bg: 'rgba(255,184,77,0.12)', border: 'rgba(255,184,77,0.3)' };
// INTERNAL micro-party marker style (matches the EventForm + legend amber).
const INTERNAL_STYLE = { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.4)' };

function eventStyle(evt) {
  return evt?.visibility === 'internal' ? INTERNAL_STYLE : PUBLIC_STYLE;
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

export default function CalendarClient({ publicEvents, teamEvents: initialTeamEvents }) {
  const router = useRouter();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [teamEvents, setTeamEvents] = useState(initialTeamEvents);
  const [modalState, setModalState] = useState(null); // null | { mode:'create', date } | { mode:'edit', event }
  const [selectedDay, setSelectedDay] = useState(null);

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

  const handleDayClick = (date) => {
    setSelectedDay(date);
  };

  const handleDayDoubleClick = (date) => {
    setModalState({ mode: 'create', date });
  };

  const handleEventClick = (e, evt, type) => {
    e.stopPropagation();
    if (type === 'team') {
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

  // Selected day detail
  const selectedEvents = selectedDay ? getEventsForDate(selectedDay) : null;

  return (
    <main className="max-w-[1400px] mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link
            href="/bananas"
            className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-3 transition-opacity hover:opacity-70"
            style={{ color: '#8a8a8a' }}
          >
            ← BACK TO ADMIN
          </Link>
          <h1
            className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Team Calendar
          </h1>
          <p className="text-[13px] mt-1" style={{ color: '#8a8a8a' }}>
            Admin-only · click a day to view · double-click to add an event
          </p>
        </div>
        <button
          onClick={() => setModalState({ mode: 'create', date: today })}
          className="px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          + ADD EVENT
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-6">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em]" style={{ color: '#8a8a8a' }}>
          LEGEND:
        </span>
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PUBLIC_STYLE.color, border: `1px solid ${PUBLIC_STYLE.border}` }} />
          <span style={{ color: '#aaa' }}>Public Event</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: INTERNAL_STYLE.color, border: `1px solid ${INTERNAL_STYLE.border}` }} />
          <span style={{ color: '#aaa' }}>Micro Party (Internal)</span>
        </span>
        {Object.entries(CATEGORIES).map(([key, cat]) => (
          <span key={key} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: cat.color }} />
            <span style={{ color: '#aaa' }}>{cat.label}</span>
          </span>
        ))}
      </div>

      {/* Month nav */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={prevMonth}
          className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors hover:bg-white/10 text-[16px]"
          style={{ borderColor: 'rgba(255,255,255,0.12)' }}
        >
          ‹
        </button>
        <h2
          className="text-[22px] font-extrabold -tracking-[0.01em] min-w-[220px] text-center"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {MONTHS[month]} {year}
        </h2>
        <button
          onClick={nextMonth}
          className="w-9 h-9 rounded-full border flex items-center justify-center transition-colors hover:bg-white/10 text-[16px]"
          style={{ borderColor: 'rgba(255,255,255,0.12)' }}
        >
          ›
        </button>
        <button
          onClick={goToday}
          className="ml-2 px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/10"
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#aaa' }}
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
                className="text-center text-[11px] font-semibold tracking-[0.12em] py-2"
                style={{ color: '#8a8a8a' }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid cells */}
          <div className="grid grid-cols-7 gap-px" style={{ background: 'rgba(255,255,255,0.04)' }}>
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
                  className="min-h-[100px] p-2 cursor-pointer transition-colors"
                  style={{
                    background: isSelected
                      ? 'rgba(255,255,255,0.08)'
                      : isCurrentMonth ? '#141414' : '#0f0f0f',
                    outline: isSelected ? '1px solid rgba(255,255,255,0.2)' : 'none',
                  }}
                >
                  {/* Date number */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-[13px] font-bold w-7 h-7 flex items-center justify-center rounded-full"
                      style={{
                        background: isToday ? '#ffffff' : 'transparent',
                        color: isToday ? '#0a0a0a' : isCurrentMonth ? '#f5f5f5' : '#333',
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      {isCurrentMonth ? dayNum : ''}
                    </span>
                    {hasEvents && !isCurrentMonth && null}
                  </div>

                  {/* Events */}
                  <div className="space-y-0.5">
                    {pub.slice(0, 2).map(evt => {
                      const st = eventStyle(evt);
                      const internal = evt.visibility === 'internal';
                      return (
                        <div
                          key={`pub-${evt.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}
                          title={internal ? `${evt.title} (internal micro party)` : evt.title}
                        >
                          <div className="truncate">{internal ? '🔒' : '★'} {evt.title}</div>
                          {evt.event_time && (
                            <div className="text-[9px] font-normal opacity-80 truncate">{evt.event_time}</div>
                          )}
                        </div>
                      );
                    })}
                    {team.slice(0, 3 - Math.min(pub.length, 2)).map(evt => {
                      const cat = CATEGORIES[evt.category] || CATEGORIES.other;
                      return (
                        <div
                          key={`team-${evt.id}`}
                          onClick={(e) => handleEventClick(e, evt, 'team')}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                          style={{ background: cat.color + '33', color: cat.color, border: `1px solid ${cat.color}44` }}
                          title={evt.title}
                        >
                          <div className="truncate">{evt.title}</div>
                          {evt.start_time && (
                            <div className="text-[9px] font-normal opacity-80 truncate">
                              {evt.start_time}{evt.end_time ? ` – ${evt.end_time}` : ''}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(pub.length + team.length) > 3 && (
                      <div className="text-[9px] font-semibold" style={{ color: '#8a8a8a' }}>
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
            className="w-[280px] flex-shrink-0 rounded-[14px] border p-5 self-start sticky top-6"
            style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-[16px] font-bold"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-[18px] leading-none transition-opacity hover:opacity-50"
                style={{ color: '#8a8a8a' }}
              >
                ×
              </button>
            </div>

            {selectedEvents.pub.length === 0 && selectedEvents.team.length === 0 && (
              <p className="text-[12px]" style={{ color: '#555' }}>No events this day.</p>
            )}

            {selectedEvents.pub.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-semibold tracking-[0.12em] mb-2" style={{ color: '#8a8a8a' }}>WEBSITE EVENTS</div>
                <div className="space-y-2">
                  {selectedEvents.pub.map(evt => {
                    const st = eventStyle(evt);
                    const internal = evt.visibility === 'internal';
                    return (
                      <div
                        key={evt.id}
                        className="rounded-[8px] p-3"
                        style={{ background: st.bg, border: `1px solid ${st.border}` }}
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-[13px] font-bold" style={{ color: st.color }}>{evt.title}</div>
                          {internal && (
                            <span
                              className="text-[9px] font-bold tracking-[0.1em] px-1.5 py-0.5 rounded-full uppercase"
                              style={{ background: st.color, color: '#0a0a0a' }}
                            >
                              Internal
                            </span>
                          )}
                        </div>
                        {evt.event_time && <div className="text-[11px] mt-0.5" style={{ color: '#aaa' }}>{evt.event_time}</div>}
                        <Link
                          href={`/bananas/events/${evt.id}`}
                          className="text-[10px] mt-1 inline-block underline-offset-2 hover:underline"
                          style={{ color: '#888' }}
                        >
                          Edit →
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedEvents.team.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold tracking-[0.12em] mb-2" style={{ color: '#8a8a8a' }}>TEAM EVENTS</div>
                <div className="space-y-2">
                  {selectedEvents.team.map(evt => {
                    const cat = CATEGORIES[evt.category] || CATEGORIES.other;
                    return (
                      <div
                        key={evt.id}
                        className="rounded-[8px] p-3 cursor-pointer hover:opacity-80 transition-opacity"
                        style={{ background: cat.color + '22', border: `1px solid ${cat.color}44` }}
                        onClick={() => setModalState({ mode: 'edit', event: evt })}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                          <div className="text-[13px] font-bold" style={{ color: '#f5f5f5' }}>{evt.title}</div>
                        </div>
                        <div className="text-[11px]" style={{ color: cat.color }}>{cat.label}</div>
                        {(evt.start_time || evt.end_time) && (
                          <div className="text-[11px] mt-0.5" style={{ color: '#aaa' }}>
                            {evt.start_time}{evt.end_time ? ` – ${evt.end_time}` : ''}
                          </div>
                        )}
                        {evt.description && (
                          <div className="text-[11px] mt-1 line-clamp-2" style={{ color: '#888' }}>{evt.description}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={() => setModalState({ mode: 'create', date: selectedDay })}
              className="w-full mt-4 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/10"
              style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
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
          onSave={handleModalSave}
          onSaveBatch={handleModalSaveBatch}
          onDelete={handleModalDelete}
          onClose={() => setModalState(null)}
        />
      )}
    </main>
  );
}
