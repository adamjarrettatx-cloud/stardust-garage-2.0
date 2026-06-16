'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { adminFetch } from '@/lib/admin-fetch';

const CATEGORY_OPTIONS = [
  { value: 'workshop', label: 'Workshop' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'party', label: 'Party (Dance / Music)' },
  { value: 'other', label: 'Other' },
];

const QUALIFYING_CATEGORIES = ['workshop', 'yoga', 'party'];

const CATEGORY_DISCOUNT_DEFAULTS = {
  workshop: 60,
  yoga: 40,
  party: 60,
  other: 50,
};

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function emptyTicketType() {
  return { name: '', price: '', quantity: '', description: '' };
}

// New-event form that creates AND publishes the website event together with a
// TicketTailor event series (date/time occurrence + ticket types), with one or
// more ticket types. On success both sides are already live and it sends the
// admin to the event editor. All TicketTailor work happens server-side in
// /api/admin/events/create-with-tt — the API key is never seen by the browser.
export default function TtEventCreator() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [eventEndTime, setEventEndTime] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [category, setCategory] = useState('party');
  const [memberDiscountPercent, setMemberDiscountPercent] = useState(
    String(CATEGORY_DISCOUNT_DEFAULTS.party),
  );
  const [ticketTypes, setTicketTypes] = useState([emptyTicketType()]);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (!slug) setSlug(slugify(newTitle));
  };

  const handleCategoryChange = (e) => {
    const newCategory = e.target.value;
    setCategory(newCategory);
    if (QUALIFYING_CATEGORIES.includes(newCategory)) {
      setMemberDiscountPercent(String(CATEGORY_DISCOUNT_DEFAULTS[newCategory]));
    } else {
      setMemberDiscountPercent('');
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    const supabase = createClient();
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const { error: uploadError } = await supabase.storage.from('event-images').upload(fileName, file);
    if (uploadError) {
      setError('Upload failed: ' + uploadError.message);
      setUploading(false);
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from('event-images').getPublicUrl(fileName);
    setImageUrl(publicUrl);
    setUploading(false);
  };

  const updateTicket = (index, field, value) => {
    setTicketTypes((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const addTicket = () => setTicketTypes((prev) => [...prev, emptyTicketType()]);

  const removeTicket = (index) =>
    setTicketTypes((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNote('');
    setSaving(true);

    const payload = {
      title: title.trim(),
      slug: slug.trim() || slugify(title),
      event_date: eventDate,
      event_time: eventTime.trim() || null,
      event_end_time: eventEndTime.trim() || null,
      description: description.trim() || null,
      image_url: imageUrl.trim() || null,
      category,
      member_discount_percent:
        QUALIFYING_CATEGORIES.includes(category) && memberDiscountPercent.trim() !== ''
          ? Number(memberDiscountPercent)
          : null,
      ticket_types: ticketTypes.map((t) => ({
        name: t.name.trim(),
        price: t.price,
        quantity: t.quantity,
        description: t.description.trim() || null,
      })),
    };

    try {
      const res = await adminFetch('/api/admin/events/create-with-tt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // Both sides are now live. Send the admin to the editor. If TicketTailor
      // was skipped (no key), surface that briefly first.
      if (res.ttNote) {
        setNote(res.ttNote);
        setTimeout(() => {
          router.push(`/admin/events/${res.eventId}`);
          router.refresh();
        }, 2500);
      } else {
        router.push(`/admin/events/${res.eventId}`);
        router.refresh();
      }
    } catch (err) {
      setError(err?.message || 'Failed to create event');
      setSaving(false);
    }
  };

  const inputStyle = { background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' };
  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: '#8a8a8a' };
  const inputClass =
    'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

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
        className="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-3"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        New Ticketed Event
      </h1>
      <p className="text-[13px] mb-10" style={{ color: '#8a8a8a' }}>
        Creates and publishes a website event and a TicketTailor event series together — date, times
        and ticket types included. Both go live as soon as TicketTailor confirms the box office and
        returns a ticket link; if anything fails, the website event is kept as a hidden draft so the
        public page never shows an event you can&rsquo;t buy tickets for.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className={labelClass} style={labelStyle}>TITLE</label>
          <input type="text" value={title} onChange={handleTitleChange} required className={inputClass} style={inputStyle} />
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

        <div>
          <label className={labelClass} style={labelStyle}>DATE</label>
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required className={inputClass} style={inputStyle} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={labelStyle}>START TIME</label>
            <input type="text" value={eventTime} onChange={(e) => setEventTime(e.target.value)} required placeholder="e.g. 10:00 PM" className={inputClass} style={inputStyle} />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>END TIME</label>
            <input type="text" value={eventEndTime} onChange={(e) => setEventEndTime(e.target.value)} required placeholder="e.g. 11:30 PM" className={inputClass} style={inputStyle} />
          </div>
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>DESCRIPTION</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className={inputClass + ' resize-y'} style={inputStyle} />
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>CATEGORY</label>
          <select value={category} onChange={handleCategoryChange} className={inputClass} style={inputStyle}>
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

        {QUALIFYING_CATEGORIES.includes(category) && (
          <div>
            <label className={labelClass} style={labelStyle}>MEMBER DISCOUNT %</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={memberDiscountPercent}
                onChange={(e) => setMemberDiscountPercent(e.target.value)}
                className={inputClass + ' max-w-[140px]'}
                style={inputStyle}
              />
              <span className="text-[14px]" style={{ color: '#8a8a8a' }}>%</span>
            </div>
          </div>
        )}

        {/* TICKET TYPES */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className={labelClass + ' mb-0'} style={labelStyle}>TICKET TYPES</label>
            <button
              type="button"
              onClick={addTicket}
              className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5"
              style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
            >
              + ADD TICKET TYPE
            </button>
          </div>

          <div className="space-y-4">
            {ticketTypes.map((t, i) => (
              <div
                key={i}
                className="rounded-[12px] border p-4"
                style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>
                    TICKET {i + 1}
                  </span>
                  {ticketTypes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTicket(i)}
                      className="text-[11px] font-semibold tracking-[0.12em] transition-opacity hover:opacity-70"
                      style={{ color: '#ff8080' }}
                    >
                      REMOVE
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="block text-[10px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: '#8a8a8a' }}>NAME</label>
                    <input
                      type="text"
                      value={t.name}
                      onChange={(e) => updateTicket(i, 'name', e.target.value)}
                      placeholder="General Admission"
                      className={inputClass + ' py-2.5'}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: '#8a8a8a' }}>PRICE (USD)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={t.price}
                      onChange={(e) => updateTicket(i, 'price', e.target.value)}
                      placeholder="0.00"
                      className={inputClass + ' py-2.5'}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: '#8a8a8a' }}>CAPACITY</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={t.quantity}
                      onChange={(e) => updateTicket(i, 'quantity', e.target.value)}
                      placeholder="unlimited"
                      className={inputClass + ' py-2.5'}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-[10px] font-semibold tracking-[0.12em] mb-1.5" style={{ color: '#8a8a8a' }}>DESCRIPTION (OPTIONAL)</label>
                  <input
                    type="text"
                    value={t.description}
                    onChange={(e) => updateTicket(i, 'description', e.target.value)}
                    className={inputClass + ' py-2.5'}
                    style={inputStyle}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            Price in dollars (use 0 for free). Leave capacity blank for unlimited.
          </p>
        </div>

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
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            This image is saved on the Stardust website event page. TicketTailor&rsquo;s
            event image isn&rsquo;t set automatically yet — add it in the TicketTailor
            dashboard if you want it on the box office page too.
          </p>
        </div>

        {error && (
          <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
            {error}
          </div>
        )}
        {note && (
          <div className="text-[13px] p-3 rounded-[10px] border" style={{ color: '#ffb84d', borderColor: 'rgba(255,184,77,0.3)', background: 'rgba(255,184,77,0.08)' }}>
            {note}
          </div>
        )}

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={saving || uploading}
            className="flex-1 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            {saving ? 'PUBLISHING…' : 'CREATE & PUBLISH'}
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
