'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const CATEGORY_OPTIONS = [
  { value: 'workshop', label: 'Workshop' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'party', label: 'Party (Dance / Music)' },
  { value: 'other', label: 'Other' },
];

const QUALIFYING_CATEGORIES = ['workshop', 'yoga', 'party'];

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function EventForm({ event }) {
  const router = useRouter();
  const isEditing = !!event;

  const [title, setTitle] = useState(event?.title || '');
  const [eventDate, setEventDate] = useState(event?.event_date || '');
  const [eventTime, setEventTime] = useState(event?.event_time || '');
  const [description, setDescription] = useState(event?.description || '');
  const [imageUrl, setImageUrl] = useState(event?.image_url || '');
  const [slug, setSlug] = useState(event?.slug || '');
  // Event type: 'public' (with tickets) or 'private' (no ticket link)
  const [eventType, setEventType] = useState(
    event?.ticket_url ? 'public' : isEditing ? 'private' : 'public'
  );
  const [ticketUrl, setTicketUrl] = useState(event?.ticket_url || '');
  const [category, setCategory] = useState(event?.category || 'other');
  const [ttEventSeriesId, setTtEventSeriesId] = useState(event?.tt_event_series_id || '');
  const [ttSeries, setTtSeries] = useState([]);
  const [ttSeriesError, setTtSeriesError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load TicketTailor event series so admins can pick one for discount codes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/tt-event-series');
        const body = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(body.series)) {
          setTtSeries(body.series);
        } else {
          setTtSeriesError(body?.error || 'Could not load TicketTailor event series');
        }
      } catch (err) {
        if (!cancelled) setTtSeriesError(err?.message || 'Could not load TicketTailor event series');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (!isEditing || !slug) {
      setSlug(slugify(newTitle));
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setUploading(true);

    const supabase = createClient();
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    const { error: uploadError } = await supabase.storage
      .from('event-images')
      .upload(fileName, file);

    if (uploadError) {
      setError('Upload failed: ' + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('event-images')
      .getPublicUrl(fileName);

    setImageUrl(publicUrl);
    setUploading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const supabase = createClient();
    const payload = {
      title: title.trim(),
      event_date: eventDate,
      event_time: eventTime.trim() || null,
      description: description.trim() || null,
      image_url: imageUrl.trim() || null,
      slug: slug.trim() || slugify(title),
      ticket_url: eventType === 'public' ? (ticketUrl.trim() || null) : null,
      category,
      tt_event_series_id: ttEventSeriesId.trim() || null,
    };

    const { data: saved, error: saveError } = isEditing
      ? await supabase.from('events').update(payload).eq('id', event.id).select().single()
      : await supabase.from('events').insert(payload).select().single();

    if (saveError) {
      setError('Save failed: ' + saveError.message);
      setSaving(false);
      return;
    }

    // Auto-trigger discount code generation for qualifying events that have a
    // TicketTailor series linked. Non-fatal: a failure here shouldn't block the
    // save, so we surface a warning but still navigate away.
    const savedId = saved?.id || event?.id;
    if (savedId && QUALIFYING_CATEGORIES.includes(category) && payload.tt_event_series_id) {
      try {
        await fetch('/api/admin/generate-event-discounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: savedId }),
        });
      } catch (err) {
        console.error('Discount code generation trigger failed:', err);
      }
    }

    router.push('/admin');
    router.refresh();
  };

  const inputStyle = {
    background: '#141414',
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#f5f5f5',
  };

  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: '#8a8a8a' };
  const inputClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

  return (
    <main className="max-w-[700px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="inline-block text-[12px] font-semibold tracking-[0.14em] mb-8 transition-opacity hover:opacity-70"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>

      <h1
        className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-10"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {isEditing ? 'Edit Event' : 'New Event'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className={labelClass} style={labelStyle}>TITLE</label>
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>URL SLUG</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="auto-generated-from-title"
            className={inputClass}
            style={inputStyle}
          />
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            This becomes the URL: /events/{slug || 'your-slug'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
          <div>
            <label className={labelClass} style={labelStyle}>TIME</label>
            <input
              type="text"
              value={eventTime}
              onChange={(e) => setEventTime(e.target.value)}
              placeholder="e.g. 10:00 PM"
              className={inputClass}
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>DESCRIPTION</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            className={inputClass + ' resize-y'}
            style={inputStyle}
          />
        </div>

        {/* CATEGORY */}
        <div>
          <label className={labelClass} style={labelStyle}>CATEGORY</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
            style={inputStyle}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ background: '#141414' }}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            Workshop, Yoga, and Party events generate member discount codes automatically.
          </p>
        </div>

        {/* TICKETTAILOR EVENT SERIES */}
        <div>
          <label className={labelClass} style={labelStyle}>TICKETTAILOR EVENT SERIES</label>
          {ttSeries.length > 0 ? (
            <select
              value={ttEventSeriesId}
              onChange={(e) => setTtEventSeriesId(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="" style={{ background: '#141414' }}>
                — None —
              </option>
              {ttSeries.map((s) => (
                <option key={s.id} value={s.id} style={{ background: '#141414' }}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={ttEventSeriesId}
              onChange={(e) => setTtEventSeriesId(e.target.value)}
              placeholder="ev_xxxxxxxx"
              className={inputClass}
              style={inputStyle}
            />
          )}
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            {ttSeriesError
              ? `Could not load series list (${ttSeriesError}). Enter the series ID manually.`
              : 'Link the TicketTailor event series so member discount codes apply to its tickets.'}
          </p>
        </div>

        {/* EVENT TYPE TOGGLE */}
        <div>
          <label className={labelClass} style={labelStyle}>EVENT TYPE</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setEventType('public')}
              className="py-4 px-5 rounded-[10px] border text-left transition-all"
              style={{
                background: eventType === 'public' ? '#ffffff' : '#141414',
                borderColor: eventType === 'public' ? '#ffffff' : 'rgba(255,255,255,0.1)',
                color: eventType === 'public' ? '#0a0a0a' : '#f5f5f5',
              }}
            >
              <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Public Event
              </div>
              <div className="text-[12px]" style={{ color: eventType === 'public' ? '#555' : '#8a8a8a' }}>
                Sell tickets via link
              </div>
            </button>
            <button
              type="button"
              onClick={() => setEventType('private')}
              className="py-4 px-5 rounded-[10px] border text-left transition-all"
              style={{
                background: eventType === 'private' ? '#ffffff' : '#141414',
                borderColor: eventType === 'private' ? '#ffffff' : 'rgba(255,255,255,0.1)',
                color: eventType === 'private' ? '#0a0a0a' : '#f5f5f5',
              }}
            >
              <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Private Event
              </div>
              <div className="text-[12px]" style={{ color: eventType === 'private' ? '#555' : '#8a8a8a' }}>
                Venue rental, no tickets
              </div>
            </button>
          </div>
        </div>

        {/* TICKET URL - only show if public */}
        {eventType === 'public' && (
          <div>
            <label className={labelClass} style={labelStyle}>TICKET URL</label>
            <input
              type="url"
              value={ticketUrl}
              onChange={(e) => setTicketUrl(e.target.value)}
              placeholder="https://..."
              className={inputClass}
              style={inputStyle}
            />
            <p className="text-[11px] mt-2" style={{ color: '#555' }}>
              Link to Eventbrite, Shopify, Dice, etc. Leave blank if tickets are not yet available.
            </p>
          </div>
        )}

        <div>
          <label className={labelClass} style={labelStyle}>IMAGE</label>
          {imageUrl && (
            <div className="mb-3 rounded-[10px] overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <img src={imageUrl} alt="Event preview" className="w-full h-auto max-h-[300px] object-cover" />
            </div>
          )}
          <div className="flex flex-col gap-3">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={uploading}
              className="text-[13px] file:mr-4 file:px-5 file:py-2.5 file:rounded-full file:border-0 file:text-[12px] file:font-semibold file:tracking-[0.12em] file:bg-white file:text-black file:cursor-pointer hover:file:bg-gray-200"
              style={{ color: '#8a8a8a' }}
            />
            {uploading && <p className="text-[13px]" style={{ color: '#8a8a8a' }}>Uploading...</p>}
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Or paste an image URL"
              className={inputClass}
              style={inputStyle}
            />
          </div>
        </div>

        {error && (
          <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={saving || uploading}
            className="flex-1 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            {saving ? 'SAVING...' : isEditing ? 'SAVE CHANGES' : 'CREATE EVENT'}
          </button>
          <Link
            href="/admin"
            className="px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5 flex items-center"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            CANCEL
          </Link>
        </div>
      </form>
    </main>
  );
}
