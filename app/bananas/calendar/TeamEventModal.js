'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

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

const FREQ_OPTIONS = [
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly',  label: 'Monthly' },
];

export default function TeamEventModal({
  mode,
  event,
  defaultDate,
  categories,
  onSave,
  onSaveBatch,
  onDelete,
  onClose,
}) {
  const isEdit = mode === 'edit';
  const supabase = createClient();

  const [title, setTitle] = useState(event?.title || '');
  const [eventDate, setEventDate] = useState(
    event?.event_date || toDateInput(defaultDate) || ''
  );
  const [startTime, setStartTime] = useState(event?.start_time || '');
  const [endTime, setEndTime] = useState(event?.end_time || '');
  const [category, setCategory] = useState(event?.category || 'internal');
  const [description, setDescription] = useState(event?.description || '');

  // Recurrence state
  const [recurring, setRecurring] = useState(event?.is_recurring || false);
  const [recurrenceFreq, setRecurrenceFreq] = useState(event?.recurrence_freq || 'weekly');
  const [recurrenceEnd, setRecurrenceEnd] = useState(event?.recurrence_end || '');

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [deleteScope, setDeleteScope] = useState(null); // null | 'one' | 'all'
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    background: '#1a1a1a',
    borderColor: 'rgba(255,255,255,0.12)',
    color: '#f5f5f5',
  };
  const inputClass = 'w-full px-4 py-3 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const labelClass = 'block text-[11px] font-semibold tracking-[0.14em] mb-1.5';
  const labelStyle = { color: '#8a8a8a' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[480px] rounded-[16px] border p-7 max-h-[90vh] overflow-y-auto"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-[22px] font-extrabold -tracking-[0.01em]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {isEdit ? 'Edit Event' : 'Add Team Event'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[20px] leading-none transition-colors hover:bg-white/10"
            style={{ color: '#8a8a8a' }}
          >
            ×
          </button>
        </div>

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
                  className="py-2.5 px-3 rounded-[10px] border text-left text-[12px] font-semibold transition-all flex items-center gap-2"
                  style={{
                    background: category === key ? cat.color : '#1a1a1a',
                    borderColor: category === key ? cat.color : 'rgba(255,255,255,0.08)',
                    color: category === key ? cat.text : '#aaa',
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

          {/* ── RECURRING TOGGLE ── */}
          {!isEdit && (
            <div>
              <button
                type="button"
                onClick={() => setRecurring(r => !r)}
                className="w-full flex items-center justify-between px-4 py-3.5 rounded-[10px] border transition-all"
                style={{
                  background: recurring ? 'rgba(139,92,246,0.15)' : '#1a1a1a',
                  borderColor: recurring ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.1)',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-[18px]">🔁</span>
                  <div className="text-left">
                    <div className="text-[13px] font-semibold" style={{ color: recurring ? '#c4b5fd' : '#f5f5f5' }}>
                      Recurring Event
                    </div>
                    <div className="text-[11px]" style={{ color: '#8a8a8a' }}>
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
                    <label className={labelClass} style={{ color: '#c4b5fd' }}>FREQUENCY</label>
                    <div className="grid grid-cols-3 gap-2">
                      {FREQ_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setRecurrenceFreq(opt.value)}
                          className="py-2.5 rounded-[8px] text-[12px] font-semibold border transition-all"
                          style={{
                            background: recurrenceFreq === opt.value ? '#8b5cf6' : '#1a1a1a',
                            borderColor: recurrenceFreq === opt.value ? '#8b5cf6' : 'rgba(255,255,255,0.08)',
                            color: recurrenceFreq === opt.value ? '#fff' : '#aaa',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* End date */}
                  <div>
                    <label className={labelClass} style={{ color: '#c4b5fd' }}>REPEAT UNTIL</label>
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
                      className="text-[12px] font-semibold text-center py-2 rounded-[8px]"
                      style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}
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
              style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.3)' }}
            >
              🔁 Part of a recurring series ({event.recurrence_freq})
              <span className="text-[11px] font-normal ml-auto" style={{ color: '#8a8a8a' }}>
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
              style={{ background: '#ffffff', color: '#0a0a0a' }}
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
              className="px-6 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5"
              style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
            >
              CANCEL
            </button>
          </div>

          {/* ── DELETE (edit mode) ── */}
          {isEdit && (
            <div className="pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {deleteScope === 'picker' ? (
                // Series delete picker
                <div className="mt-3 space-y-2">
                  <p className="text-[12px] text-center mb-3" style={{ color: '#8a8a8a' }}>
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
                    className="w-full py-2 text-[11px] transition-opacity hover:opacity-70"
                    style={{ color: '#8a8a8a' }}
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
                  <p className="text-[11px] text-center" style={{ color: '#8a8a8a' }}>
                    This cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="w-full py-1.5 text-[11px] transition-opacity hover:opacity-70"
                    style={{ color: '#8a8a8a' }}
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
      </div>
    </div>
  );
}
