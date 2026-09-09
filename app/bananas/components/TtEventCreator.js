'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { adminFetch } from '@/lib/admin-fetch';
import EventContactFields from './EventContactFields';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { CONTACT_REQUIRED_MESSAGE } from '@/lib/contact-helpers';
import { uploadEventImage } from '@/lib/event-image-upload';

// Mirrors the calendar legend in app/components/EventsCalendarClient.js so the
// TicketTailor creator and the internal calendar share one taxonomy.
const CATEGORY_OPTIONS = [
  { value: 'internal', label: 'Internal' },
  { value: 'team_meeting', label: 'Team Meeting' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'yoga_residency', label: 'Yoga Residency' },
  { value: 'evening_music_residency', label: 'Evening Music Residency' },
  { value: 'day_party', label: 'Day Party' },
  { value: 'trial_resident_party', label: 'Trial Resident Party' },
  { value: 'sdg_party', label: 'SDG Party' },
  { value: 'workshop', label: 'Workshop' },
];

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// New-event form that creates a website event shell in `internal` ticketing
// mode. Products, tiers, booking fees, per-tier status, access codes, and
// discount codes are all configured on the event editor's Ticketing panel
// AFTER the shell is created — there is exactly one Ticketing UI in the app
// (see components/ticketing/ProductEditor.jsx + DiscountCodesManager.jsx),
// and it lives on `/bananas/events/[id]`. This page's job is only to name and
// date the event, then hand off to that editor. No TicketTailor calls happen
// here anymore.
export default function TtEventCreator() {
  const router = useRouter();
  // The calendar day-click modal routes here with ?date=YYYY-MM-DD when the
  // user picks 'Public' after clicking a day — pre-fill the date field so
  // they don't have to type it again. We validate the shape to avoid trusting
  // arbitrary query-string input.
  const searchParams = useSearchParams();
  const prefillDate = (() => {
    const raw = searchParams?.get('date') || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  })();

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [eventDate, setEventDate] = useState(prefillDate);
  const [eventTime, setEventTime] = useState('');
  const [eventEndTime, setEventEndTime] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [category, setCategory] = useState('day_party');
  // Defaults to "has an outside partner" so the team opts into SDG-only rather
  // than defaulting into the path that skips the contact requirement.
  const [isSdgOnly, setIsSdgOnly] = useState(false);
  const [contactId, setContactId] = useState(null);

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
    setCategory(e.target.value);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    // Resize + re-encode client-side before upload — see
    // lib/event-image-upload.js for the size/quality rationale. Falls
    // back to the raw file if compression fails so uploads are never
    // blocked by a compression bug.
    const { publicUrl, error: uploadError } = await uploadEventImage(createClient(), file);
    if (uploadError) {
      setError('Upload failed: ' + uploadError.message);
      setUploading(false);
      return;
    }
    setImageUrl(publicUrl);
    setUploading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNote('');

    if (!isSdgOnly && !contactId) {
      setError(CONTACT_REQUIRED_MESSAGE);
      return;
    }

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
      is_sdg_only: isSdgOnly,
      contact_id: isSdgOnly ? null : contactId,
      // Internal-ticketing v2: no ticket types on create. The event editor's
      // Ticketing panel (products + tiers + statuses + access codes + discount
      // codes + booking fees) takes over from here.
      ticketing_mode: 'internal',
      ticket_types: [],
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
          router.push(`/bananas/events/${res.eventId}`);
          router.refresh();
        }, 2500);
      } else {
        router.push(`/bananas/events/${res.eventId}`);
        router.refresh();
      }
    } catch (err) {
      setError(err?.message || 'Failed to create event');
      setSaving(false);
    }
  };

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };
  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: 'var(--auth-muted)' };
  const inputClass =
    'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';

  return (
    <div className="max-w-[700px]">
      <AuthenticatedPageHeader
        backHref="/bananas?tab=events"
        backLabel="← BACK TO ADMIN"
        title="New Ticketed Event"
        description="Saves the event as a hidden draft and drops you into the event editor, where the Ticketing panel handles products, tiers, booking fees, access codes, and discount codes. The event stays hidden from the public until you publish it from the editor."
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

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
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] mt-2" style={{ color: '#555' }}>
            Member discounts (Weekender / Experience) are configured on the event editor’s Ticketing panel after you save.
          </p>
        </div>

        {/* CONTACT / SDG-ONLY — required unless the event is fully internal */}
        <EventContactFields
          isSdgOnly={isSdgOnly}
          onSdgOnlyChange={setIsSdgOnly}
          contactId={contactId}
          onContactIdChange={setContactId}
        />

        {/* Ticket configuration happens on the event editor after this form is
            saved. Removed the old inline ticket-types block so there is exactly
            one Ticketing UI in the app. */}
        <div
          className="rounded-[12px] border p-4"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <div className="text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
            TICKETS
          </div>
          <p className="text-[13px] leading-[1.6]" style={{ color: '#c8c8c8' }}>
            After you save this event you’ll land on the event editor, where the
            <strong> Ticketing </strong> panel lets you configure products, price tiers, per‑tier status
            (active / hidden / sold out / access code required), booking fees, tier reveal thresholds,
            and discount codes.
          </p>
        </div>

        <div>
          <label className={labelClass} style={labelStyle}>IMAGE</label>
          {imageUrl && (
            <div className="mb-3 rounded-[10px] overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
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
          <div className="text-[13px] p-3 rounded-[10px] border" style={{ color: '#d9c48c', borderColor: 'rgba(217,196,140,0.3)', background: 'rgba(217,196,140,0.08)' }}>
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
            {saving ? 'SAVING…' : 'SAVE & CONFIGURE TICKETS'}
          </button>
          <Link
            href="/bananas?tab=events"
            className="px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5 flex items-center"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            CANCEL
          </Link>
        </div>
      </form>
    </div>
  );
}
