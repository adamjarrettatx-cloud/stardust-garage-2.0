'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { linkedEventHref } from '@/lib/linked-event-link';

function toDateInput(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Generate all occurrence dates from a start date given a frequency + end date
function generateOccurrences(startDateStr, freq, endDateStr) {
  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  const end = new Date(ey, em - 1, ed);

  const dates = [];
  let current = new Date(sy, sm - 1, sd);

  while (current <= end) {
    dates.push(toDateInput(current));
    if (freq === 'weekly') {
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7);
    } else if (freq === 'biweekly') {
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 14);
    } else if (freq === 'monthly') {
      current = new Date(current.getFullYear(), current.getMonth() + 1, current.getDate());
    } else {
      break;
    }
    // Safety cap: 104 occurrences (2 years of weekly)
    if (dates.length >= 104) break;
  }
  return dates;
}

// Site events arrive as YYYY-MM-DD; parse at local midnight so the label never
// shifts a day in negative-offset timezones.
function formatEventDate(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

const FREQ_OPTIONS = [
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly',  label: 'Monthly' },
];

// Modal palettes, kept in sync with the calendar page's light/dark toggle.
const MODAL_THEMES = {
  dark: {
    overlay: 'rgba(0,0,0,0.75)',
    panelBg: '#141414',
    panelBorder: 'rgba(255,255,255,0.1)',
    text: '#f5f5f5',
    textStrong: '#ffffff',
    muted: '#8a8a8a',
    mutedStrong: '#aaaaaa',
    inputBg: '#1a1a1a',
    inputBorder: 'rgba(255,255,255,0.12)',
    swatchBg: '#1a1a1a',
    swatchBorder: 'rgba(255,255,255,0.08)',
    hoverBg: 'rgba(255,255,255,0.05)',
    saveBg: '#ffffff',
    saveText: '#0a0a0a',
    cancelBorder: 'rgba(255,255,255,0.15)',
    divider: 'rgba(255,255,255,0.06)',
  },
  light: {
    overlay: 'rgba(20,18,14,0.45)',
    panelBg: '#ffffff',
    panelBorder: 'rgba(0,0,0,0.1)',
    text: '#1a1a1d',
    textStrong: '#000000',
    muted: '#5c5c63',
    mutedStrong: '#3a3a40',
    inputBg: '#f5f4f1',
    inputBorder: 'rgba(0,0,0,0.15)',
    swatchBg: '#f5f4f1',
    swatchBorder: 'rgba(0,0,0,0.1)',
    hoverBg: 'rgba(0,0,0,0.05)',
    saveBg: '#1a1a1d',
    saveText: '#ffffff',
    cancelBorder: 'rgba(0,0,0,0.15)',
    divider: 'rgba(0,0,0,0.08)',
  },
};

export default function TeamEventModal({
  mode,
  event,
  defaultDate,
  categories,
  publicEvents = [],
  isAdmin = false,
  theme = 'dark',
  onSave,
  onSaveBatch,
  onDelete,
  onClose,
}) {
  const isEdit = mode === 'edit';
  const supabase = createClient();
  const router = useRouter();
  const m = MODAL_THEMES[theme] || MODAL_THEMES.dark;

  // Create-only: the user first picks whether this is a Public (ticketed,
  // website-published) or Internal (team-calendar only) event. Public routes
  // out to /bananas/events/new where the full TicketTailor form lives. Edit
  // mode is always internal; public events are edited from their own page.
  const [visibility, setVisibility] = useState('internal');
  const initialDateInput =
    event?.event_date || toDateInput(defaultDate) || '';
  const goToPublicCreator = () => {
    const qs = initialDateInput ? `?date=${initialDateInput}` : '';
    onClose();
    router.push(`/bananas/events/new${qs}`);
  };

  const [title, setTitle] = useState(event?.title || '');
  const [eventDate, setEventDate] = useState(
    event?.event_date || toDateInput(defaultDate) || ''
  );
  const [startTime, setStartTime] = useState(event?.start_time || '');
  const [endTime, setEndTime] = useState(event?.end_time || '');
  const [category, setCategory] = useState(event?.category || 'internal');
  const [description, setDescription] = useState(event?.description || '');
  const [linkedEventId, setLinkedEventId] = useState(event?.linked_event_id || '');

  // Recurrence state
  const [recurring, setRecurring] = useState(event?.is_recurring || false);
  const [recurrenceFreq, setRecurrenceFreq] = useState(event?.recurrence_freq || 'weekly');
  const [recurrenceEnd, setRecurrenceEnd] = useState(event?.recurrence_end || '');

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [deleteScope, setDeleteScope] = useState(null); // null | 'one' | 'all'
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Newest first, so upcoming events sit at the top and recent past ones follow.
  const linkableEvents = [...publicEvents].sort((a, b) =>
    String(b.event_date || '').localeCompare(String(a.event_date || ''))
  );

  // Team members reach this modal for their own events, so the helper link has
  // to resolve per role — the admin dashboard route would just bounce them.
  const linkedHref = linkedEventHref(
    publicEvents.find(e => String(e.id) === String(linkedEventId)),
    isAdmin
  );

  // Preview count
  const occurrenceCount = recurring && eventDate && recurrenceEnd
    ? generateOccurrences(eventDate, recurrenceFreq, recurrenceEnd).length
    : null;

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) { setError('Not signed in.'); setSaving(false); return; }

    const basePayload = {
      title: title.trim(),
      start_time: startTime.trim() || null,
      end_time: endTime.trim() || null,
      category,
      description: description.trim() || null,
      linked_event_id: linkedEventId || null,
      is_recurring: recurring,
      recurrence_freq: recurring ? recurrenceFreq : null,
      recurrence_end: recurring ? recurrenceEnd || null : null,
      updated_at: new Date().toISOString(),
      created_by: currentUser.id,
    };

    // ── EDIT ──────────────────────────────────────────────────────────────────
    if (isEdit) {
      // If this event is part of a series and user is editing just one,
      // we only update this row. The date stays as-is.
      // Exclude created_by from updates — ownership never changes after creation.
      const { created_by: _cb, ...updateBase } = basePayload;
      const payload = { ...updateBase, event_date: eventDate };
      const { data, error: saveErr } = await supabase
        .from('team_events')
        .update(payload)
        .eq('id', event.id)
        .select()
        .single();

      if (saveErr) { setError('Save failed: ' + saveErr.message); setSaving(false); return; }
      onSave(data);
      return;
    }

    // ── CREATE ─────────────────────────────────────────────────────────────────
    if (!recurring) {
      const { data, error: saveErr } = await supabase
        .from('team_events')
        .insert({ ...basePayload, event_date: eventDate })
        .select()
        .single();

      if (saveErr) { setError('Save failed: ' + saveErr.message); setSaving(false); return; }
      onSave(data);
      return;
    }

    // Recurring — generate all occurrences in one batch insert
    if (!recurrenceEnd) {
      setError('Please set an end date for the recurring series.');
      setSaving(false);
      return;
    }

    const dates = generateOccurrences(eventDate, recurrenceFreq, recurrenceEnd);
    if (dates.length === 0) {
      setError('No occurrences generated — check your start and end dates.');
      setSaving(false);
      return;
    }

    // Shared recurrence_id ties the whole series together
    const recurrenceId = crypto.randomUUID();
    const rows = dates.map(date => ({
      ...basePayload,
      event_date: date,
      recurrence_id: recurrenceId,
    }));

    const { data, error: saveErr } = await supabase
      .from('team_events')
      .insert(rows)
      .select();

    if (saveErr) { setError('Save failed: ' + saveErr.message); setSaving(false); return; }

    // Pass all events at once using the last one to trigger close
    // Parent handles array via onSaveBatch if present, otherwise call onSave per item
    if (onSaveBatch) {
      onSaveBatch(data);
    } else {
      data.forEach(evt => onSave(evt));
    }
  };

  // ── DELETE ──────────────────────────────────────────────────────────────────
  const handleDeleteClick = () => {
    if (event?.recurrence_id) {
      // Show scope picker
      setDeleteScope('picker');
    } else {
      setConfirmDelete(true);
    }
  };

  const handleDeleteConfirm = async (scope) => {
    setDeleting(true);
    let deleteErr;

    if (scope === 'all' && event?.recurrence_id) {
      ({ error: deleteErr } = await supabase
        .from('team_events')
        .delete()
        .eq('recurrence_id', event.recurrence_id));
    } else {
      ({ error: deleteErr } = await supabase
        .from('team_events')
        .delete()
        .eq('id', event.id));
    }

    if (deleteErr) {
      setError('Delete failed: ' + deleteErr.message);
      setDeleting(false);
      setDeleteScope(null);
      setConfirmDelete(false);
      return;
    }

    onDelete(event.id, scope === 'all' ? event.recurrence_id : null);
  };

  const inputStyle = {
    background: m.inputBg,
    borderColor: m.inputBorder,
    color: m.text,
  };
  const inputClass = 'w-full px-4 py-3 rounded-[10px] text-[15px] outline-none border transition-colors focus:border-white/30';
  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-1.5';
  const labelStyle = { color: m.muted };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: m.overlay }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[480px] rounded-[16px] border p-7 max-h-[90vh] overflow-y-auto"
        style={{ background: m.panelBg, borderColor: m.panelBorder, color: m.text }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-[22px] font-extrabold -tracking-[0.01em]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: m.textStrong }}
          >
            {isEdit ? 'Edit Event' : 'Add Event'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[20px] leading-none transition-colors"
            style={{ color: m.muted }}
            onMouseEnter={(e) => { e.currentTarget.style.background = m.hoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            ×
          </button>
        </div>

        {/* Visibility toggle — create mode only. Determines whether this is
            an internal team-calendar entry or a full public/ticketed event.
            Public routes to the TicketTailor creator with the clicked day
            pre-filled; Internal keeps the lightweight in-modal form. */}
        {!isEdit && (
          <div className="mb-5">
            <label className={labelClass} style={labelStyle}>EVENT TYPE</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVisibility('internal')}
                className="py-2.5 px-3 rounded-[10px] border text-[13px] font-semibold transition-all"
                style={{
                  background: visibility === 'internal' ? m.textStrong : m.swatchBg,
                  borderColor: visibility === 'internal' ? m.textStrong : m.swatchBorder,
                  color: visibility === 'internal' ? m.panelBg : m.mutedStrong,
                }}
              >
                Internal
              </button>
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className="py-2.5 px-3 rounded-[10px] border text-[13px] font-semibold transition-all"
                style={{
                  background: visibility === 'public' ? m.textStrong : m.swatchBg,
                  borderColor: visibility === 'public' ? m.textStrong : m.swatchBorder,
                  color: visibility === 'public' ? m.panelBg : m.mutedStrong,
                }}
              >
                Public
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-snug" style={{ color: m.muted }}>
              {visibility === 'internal'
                ? 'Team-only calendar entry. Not published to the website.'
                : 'Ticketed event. Publishes to the website and creates a TicketTailor series.'}
            </p>
          </div>
        )}

        {/* Public branch: send the user to the full public-event creator with
            the clicked day pre-filled. The heavy TicketTailor form (image,
            ticket types, contact, description) lives there. */}
        {!isEdit && visibility === 'public' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={goToPublicCreator}
              className="w-full py-3 rounded-full text-[13px] font-semibold tracking-[0.14em] transition-all"
              style={{ background: m.saveBg, color: m.saveText }}
            >
              CONTINUE TO PUBLIC EVENT CREATOR →
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-colors"
              style={{ borderColor: m.cancelBorder, color: m.text, background: 'transparent' }}
            >
              CANCEL
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div>
            <label className={labelClass} style={labelStyle}>TITLE</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="e.g. Team Meeting, Yoga, Workshop..."
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {/* Date */}
          <div>
            <label className={labelClass} style={labelStyle}>
              {recurring ? 'START DATE' : 'DATE'}
            </label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              required
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} style={labelStyle}>START TIME</label>
              <input
                type="text"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="e.g. 10:00 AM"
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>END TIME</label>
              <input
                type="text"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="e.g. 12:00 PM"
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className={labelClass} style={labelStyle}>CATEGORY</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(categories).map(([key, cat]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key)}
                  className="py-2.5 px-3 rounded-[10px] border text-left text-[13px] font-semibold transition-all flex items-center gap-2"
                  style={{
                    background: category === key ? cat.color : m.swatchBg,
                    borderColor: category === key ? cat.color : m.swatchBorder,
                    color: category === key ? cat.text : m.mutedStrong,
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: category === key ? cat.text : cat.color }}
                  />
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Link to a real site event */}
          <div>
            <label className={labelClass} style={labelStyle}>LINK TO EVENT (OPTIONAL)</label>
            <select
              value={linkedEventId}
              onChange={(e) => setLinkedEventId(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">— No linked event —</option>
              {linkableEvents.map(evt => (
                <option key={evt.id} value={evt.id}>
                  {`${evt.title} — ${formatEventDate(evt.event_date)}${evt.visibility === 'internal' ? ' (internal)' : ''}`}
                </option>
              ))}
            </select>
            {linkedHref && (
              <a
                href={linkedHref}
                className="inline-block text-[12px] mt-1.5 underline-offset-2 hover:underline"
                style={{ color: m.muted }}
              >
                {isAdmin ? 'View linked event in dashboard →' : 'View linked event page →'}
              </a>
            )}
          </div>

          {/* ── RECURRING TOGGLE ── */}
          {!isEdit && (
            <div>
              <button
                type="button"
                onClick={() => setRecurring(r => !r)}
                className="w-full flex items-center justify-between px-4 py-3.5 rounded-[10px] border transition-all"
                style={{
                  background: recurring ? 'rgba(139,92,246,0.15)' : m.swatchBg,
                  borderColor: recurring ? 'rgba(139,92,246,0.5)' : m.inputBorder,
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[18px]">🔁</span>
                  <div className="text-left">
                    <div className="text-[14px] font-semibold" style={{ color: recurring ? '#8b5cf6' : m.text }}>
                      Recurring Event
                    </div>
                    <div className="text-[12px]" style={{ color: m.muted }}>
                      Repeat on a schedule
                    </div>
                  </div>
                </div>
                {/* Toggle pill */}
                <div
                  className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                  style={{ background: recurring ? '#8b5cf6' : 'rgba(255,255,255,0.12)' }}
                >
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                    style={{
                      background: '#fff',
                      left: recurring ? '22px' : '2px',
                    }}
                  />
                </div>
              </button>

              {/* Recurrence options */}
              {recurring && (
                <div
                  className="mt-3 rounded-[10px] border p-4 space-y-4"
                  style={{ background: 'rgba(139,92,246,0.08)', borderColor: 'rgba(139,92,246,0.25)' }}
                >
                  {/* Frequency */}
                  <div>
                    <label className={labelClass} style={{ color: '#8b5cf6' }}>FREQUENCY</label>
                    <div className="grid grid-cols-3 gap-2">
                      {FREQ_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setRecurrenceFreq(opt.value)}
                          className="py-2.5 rounded-[8px] text-[13px] font-semibold border transition-all"
                          style={{
                            background: recurrenceFreq === opt.value ? '#8b5cf6' : m.swatchBg,
                            borderColor: recurrenceFreq === opt.value ? '#8b5cf6' : m.swatchBorder,
                            color: recurrenceFreq === opt.value ? '#fff' : m.mutedStrong,
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* End date */}
                  <div>
                    <label className={labelClass} style={{ color: '#8b5cf6' }}>REPEAT UNTIL</label>
                    <input
                      type="date"
                      value={recurrenceEnd}
                      onChange={(e) => setRecurrenceEnd(e.target.value)}
                      min={eventDate}
                      required={recurring}
                      className={inputClass}
                      style={{ ...inputStyle, borderColor: 'rgba(139,92,246,0.3)' }}
                    />
                  </div>

                  {/* Preview */}
                  {occurrenceCount !== null && (
                    <div
                      className="text-[13px] font-semibold text-center py-2 rounded-[8px]"
                      style={{ background: 'rgba(139,92,246,0.15)', color: theme === 'light' ? '#6d28d9' : '#c4b5fd' }}
                    >
                      {occurrenceCount === 1
                        ? '1 occurrence will be created'
                        : `${occurrenceCount} occurrences will be created`}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Recurring badge on edit */}
          {isEdit && event?.is_recurring && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px] font-semibold"
              style={{ background: 'rgba(139,92,246,0.15)', color: theme === 'light' ? '#6d28d9' : '#c4b5fd', border: '1px solid rgba(139,92,246,0.3)' }}
            >
              🔁 Part of a recurring series ({event.recurrence_freq})
              <span className="text-[12px] font-normal ml-auto" style={{ color: m.muted }}>
                editing this occurrence only
              </span>
            </div>
          )}

          {/* Description */}
          <div>
            <label className={labelClass} style={labelStyle}>NOTES / DESCRIPTION</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional details..."
              className={inputClass + ' resize-y'}
              style={inputStyle}
            />
          </div>

          {error && (
            <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
              {error}
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: m.saveBg, color: m.saveText }}
            >
              {saving
                ? 'SAVING...'
                : isEdit
                  ? 'SAVE CHANGES'
                  : recurring
                    ? `CREATE ${occurrenceCount ?? ''} EVENTS`
                    : 'ADD EVENT'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors"
              style={{ borderColor: m.cancelBorder, color: m.text }}
              onMouseEnter={(e) => { e.currentTarget.style.background = m.hoverBg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              CANCEL
            </button>
          </div>

          {/* ── DELETE (edit mode) ── */}
          {isEdit && (
            <div className="pt-1 border-t" style={{ borderColor: m.divider }}>
              {deleteScope === 'picker' ? (
                // Series delete picker
                <div className="mt-3 space-y-2">
                  <p className="text-[13px] text-center mb-3" style={{ color: m.muted }}>
                    This is a recurring event. What do you want to delete?
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDeleteConfirm('one')}
                    disabled={deleting}
                    className="w-full py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] border transition-all hover:bg-white/5 disabled:opacity-50"
                    style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
                  >
                    {deleting ? 'DELETING...' : 'DELETE THIS OCCURRENCE ONLY'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteConfirm('all')}
                    disabled={deleting}
                    className="w-full py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all disabled:opacity-50"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {deleting ? 'DELETING...' : 'DELETE ENTIRE SERIES'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteScope(null)}
                    className="w-full py-2 text-[12px] transition-opacity hover:opacity-70"
                    style={{ color: m.muted }}
                  >
                    Cancel
                  </button>
                </div>
              ) : confirmDelete ? (
                <div className="mt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteConfirm('one')}
                    disabled={deleting}
                    className="w-full py-2.5 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-all disabled:opacity-50"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {deleting ? 'DELETING...' : 'CONFIRM DELETE'}
                  </button>
                  <p className="text-[12px] text-center" style={{ color: m.muted }}>
                    This cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="w-full py-1.5 text-[12px] transition-opacity hover:opacity-70"
                    style={{ color: m.muted }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="w-full mt-3 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-all hover:bg-red-500/10"
                  style={{ borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}
                >
                  DELETE EVENT
                </button>
              )}
            </div>
          )}
        </form>
        )}
      </div>
    </div>
  );
}
