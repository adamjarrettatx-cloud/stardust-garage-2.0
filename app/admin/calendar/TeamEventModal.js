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

export default function TeamEventModal({
  mode,
  event,
  defaultDate,
  categories,
  onSave,
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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

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

    const payload = {
      title: title.trim(),
      event_date: eventDate,
      start_time: startTime.trim() || null,
      end_time: endTime.trim() || null,
      category,
      description: description.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (isEdit) {
      result = await supabase
        .from('team_events')
        .update(payload)
        .eq('id', event.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('team_events')
        .insert(payload)
        .select()
        .single();
    }

    if (result.error) {
      setError('Save failed: ' + result.error.message);
      setSaving(false);
      return;
    }

    onSave(result.data);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    const { error: delErr } = await supabase.from('team_events').delete().eq('id', event.id);
    if (delErr) {
      setError('Delete failed: ' + delErr.message);
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    onDelete(event.id);
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
        {/* Modal header */}
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
            <label className={labelClass} style={labelStyle}>DATE</label>
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

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
              style={{ background: '#ffffff', color: '#0a0a0a' }}
            >
              {saving ? 'SAVING...' : isEdit ? 'SAVE CHANGES' : 'ADD EVENT'}
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

          {/* Delete (edit mode only) */}
          {isEdit && (
            <div className="pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="w-full py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all disabled:opacity-50"
                style={{
                  background: confirmDelete ? '#ef4444' : 'transparent',
                  color: confirmDelete ? '#fff' : '#ef4444',
                  border: `1px solid ${confirmDelete ? '#ef4444' : 'rgba(239,68,68,0.3)'}`,
                  marginTop: '12px',
                }}
              >
                {deleting ? 'DELETING...' : confirmDelete ? 'CONFIRM DELETE' : 'DELETE EVENT'}
              </button>
              {confirmDelete && (
                <p className="text-[11px] text-center mt-2" style={{ color: '#8a8a8a' }}>
                  Click again to confirm. This cannot be undone.
                </p>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
