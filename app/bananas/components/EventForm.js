'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import TtLinkPanel from './TtLinkPanel';
import EventContactFields from './EventContactFields';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { CONTACT_REQUIRED_MESSAGE, ensureContactTaggedEventOrganizer } from '@/lib/contact-helpers';

// Mirrors the calendar legend in app/components/EventsCalendarClient.js so the
// edit page and the internal calendar share one taxonomy. Legacy values
// (workshop, party, other, micro_party) are still accepted from historical
// records but no longer offered as new choices.
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

// Categories that generate member ticket codes (i.e. ticketed public events).
// Purely-internal categories (internal / team_meeting) are
// intentionally excluded. Legacy 'party' is still qualifying so historical
// events keep working.
const QUALIFYING_CATEGORIES = [
  'workshop',
  'yoga',
  'yoga_residency',
  'evening_music_residency',
  'day_party',
  'trial_resident_party',
  'sdg_party',
  'party',
];

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function EventForm({
  event,
  metrics = null,
  headerActions = null,
  statusPanel = null,
  // Panels that belong to an existing event but are not part of the event record
  // itself (guest list allocation), so they own their own server routes and sit
  // outside the form element.
  footerPanels = null,
}) {
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
  // Visibility: 'public' (shown on the public /events page and member surfaces)
  // or 'internal' (a "micro party" — known only to admin/team; appears on the
  // team calendar and admin dashboard but never publicly). Defaults to public.
  const [isInternal, setIsInternal] = useState(event?.visibility === 'internal');
  // Preserved for round-trip on legacy events; the input was removed and no
  // new event ever sets one via this form.
  const [ticketUrl] = useState(event?.ticket_url || '');
  // New events default to Day Party, which is the most common ticketed event
  // type. Legacy events keep whatever category was saved on the row.
  const [category, setCategory] = useState(event?.category || 'day_party');
  // A NEW event starts as "has an outside partner" so the team has to actively
  // opt into SDG-only rather than defaulting into the path that skips the
  // contact requirement. An EXISTING event keeps whatever it has — pre-migration
  // rows were backfilled to is_sdg_only = true.
  const [isSdgOnly, setIsSdgOnly] = useState(isEditing ? event.is_sdg_only !== false : false);
  const [contactId, setContactId] = useState(event?.contact_id || null);
  // `ttEventSeriesId` is preserved so the two legacy TicketTailor events
  // (ubiyu 9/18, Groove Therapy 9/19) still round-trip their linked series
  // through save(). We don't expose a picker in the form anymore — the
  // legacy events edit their link via <TtLinkPanel> (server-side route).
  const [ttEventSeriesId] = useState(event?.tt_event_series_id || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState('');

  // (Previously fetched /api/admin/tt-event-series to populate a picker on the
  // form. That picker was removed — no new events link a TicketTailor series.)

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (!isEditing || !slug) {
      setSlug(slugify(newTitle));
    }
  };

  const handleCategoryChange = (e) => {
    setCategory(e.target.value);
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

    // Every event either names the outside partner it belongs to or is flagged
    // SDG-only. Blocked here, revalidated by the DB CHECK constraint.
    if (!isSdgOnly && !contactId) {
      setError(CONTACT_REQUIRED_MESSAGE);
      return;
    }

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
      // Internal micro-party events are hidden from the public /events page and
      // member surfaces but keep all internal capabilities (contracts, SignNow,
      // financials, POS). event_type labels the internal kind; visibility is the
      // access gate the public queries filter on.
      visibility: isInternal ? 'internal' : 'public',
      event_type: isInternal ? 'micro_party' : 'standard',
      is_sdg_only: isSdgOnly,
      contact_id: isSdgOnly ? null : contactId,
    };

    // For an existing event the TT link is owned by <TtLinkPanel> (server route).
    // Writing tt_event_series_id from this form's frozen state would clobber a
    // link the panel just set, so only include it when creating a new event.
    if (!isEditing) {
      payload.tt_event_series_id = ttEventSeriesId.trim() || null;
    }

    const { data: saved, error: saveError } = isEditing
      ? await supabase.from('events').update(payload).eq('id', event.id).select().single()
      : await supabase.from('events').insert(payload).select().single();

    if (saveError) {
      setError('Save failed: ' + saveError.message);
      setSaving(false);
      return;
    }

    // Tag the linked contact as event_organizer so the Contracts panel and
    // Master Agreement lookup treat it as one. Idempotent, non-fatal.
    if (payload.contact_id) {
      await ensureContactTaggedEventOrganizer(supabase, payload.contact_id);
    }

    // Auto-trigger discount code generation for qualifying events that have a
    // TicketTailor series linked. Non-fatal: a failure here shouldn't block the
    // save, so we surface a warning but still navigate away. For an existing
    // event the link lives on the saved row (panel-owned), not the payload.
    const savedId = saved?.id || event?.id;
    const linkedSeriesId = isEditing
      ? saved?.tt_event_series_id || event?.tt_event_series_id
      : payload.tt_event_series_id;
    if (savedId && QUALIFYING_CATEGORIES.includes(category) && linkedSeriesId) {
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

    router.push('/bananas?tab=events');
    router.refresh();
  };

  const showGenerateMessage = (msg) => {
    setGenerateMessage(msg);
    setTimeout(() => setGenerateMessage(''), 5000);
  };

  const handleGenerateCodes = async () => {
    setGenerating(true);
    setGenerateMessage('');
    try {
      const res = await fetch('/api/admin/generate-event-discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, force: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        showGenerateMessage('Something went wrong. Please try again.');
      } else if (body.skipped) {
        if (body.reason === 'already_generated') {
          showGenerateMessage('Codes already generated for this event');
        } else if (body.reason === 'no_tt_series') {
          showGenerateMessage('Please link a TicketTailor event series first');
        } else if (body.reason === 'category') {
          showGenerateMessage("This event category doesn't trigger member codes");
        } else {
          showGenerateMessage('Something went wrong. Please try again.');
        }
      } else if (body.success) {
        showGenerateMessage(`Done — ${body.codesGenerated} codes generated`);
      } else {
        showGenerateMessage('Something went wrong. Please try again.');
      }
    } catch (err) {
      showGenerateMessage('Something went wrong. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const canGenerateCodes =
    isEditing && QUALIFYING_CATEGORIES.includes(category) && !!ttEventSeriesId.trim();

  const inputStyle = {
    background: 'var(--auth-input-bg)',
    borderColor: 'var(--auth-input-border)',
    color: 'var(--auth-input-text)',
  };

  const cardStyle = {
    background: 'var(--auth-card-bg)',
    borderColor: 'var(--auth-card-border)',
  };

  const labelClass = 'block text-[11px] font-semibold tracking-[0.14em] mb-1.5';
  const labelStyle = { color: 'var(--auth-muted)' };
  const inputClass = 'w-full px-4 py-2.5 rounded-[8px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const helperStyle = { color: 'var(--auth-muted)', opacity: 0.75 };
  const sectionTitle = 'text-[11px] font-semibold tracking-[0.16em] uppercase mb-4';

  // Segmented control (visibility / event type). Compact, pill-style —
  // replaces the old two big cards that ate a huge amount of vertical space.
  function Segmented({ value, options, onChange }) {
    return (
      <div
        className="inline-flex rounded-full p-1 border"
        style={{ background: 'var(--auth-input-bg)', borderColor: 'var(--auth-input-border)' }}
      >
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className="px-4 py-1.5 rounded-full text-[12px] font-semibold tracking-[0.08em] transition-all"
              style={{
                background: active ? 'var(--auth-text-strong)' : 'transparent',
                color: active ? 'var(--auth-strong-surface-text)' : 'var(--auth-muted)',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="max-w-[960px]">
      <AuthenticatedPageHeader
        backHref="/bananas?tab=events"
        backLabel="← BACK TO ADMIN"
        title={isEditing ? 'Edit Event' : 'New Event'}
        titleClassName="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-6"
      >
        {headerActions}
      </AuthenticatedPageHeader>

      {statusPanel}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* IDENTITY HERO — profile-style header with square thumbnail + title/slug. */}
        <section className="rounded-[14px] border p-5" style={cardStyle}>
          <div className="flex gap-5 items-start">
            {/* Thumbnail: click to upload. Hidden file input covers the whole tile. */}
            <label
              className="relative shrink-0 rounded-[12px] overflow-hidden border cursor-pointer group"
              style={{
                width: 112,
                height: 112,
                borderColor: 'var(--auth-card-border)',
                background: 'var(--auth-input-bg)',
              }}
              title="Click to upload event image"
            >
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Event" className="w-full h-full object-cover" />
              ) : (
                <div
                  className="w-full h-full flex flex-col items-center justify-center gap-1 text-center px-2"
                  style={{ color: 'var(--auth-muted)' }}
                >
                  <span className="text-[22px] leading-none">+</span>
                  <span className="text-[10px] font-semibold tracking-[0.1em]">ADD IMAGE</span>
                </div>
              )}
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.55)' }}
              >
                <span className="text-[10px] font-semibold tracking-[0.12em] text-white">
                  {imageUrl ? 'REPLACE' : 'UPLOAD'}
                </span>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={uploading}
                className="sr-only"
              />
            </label>

            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  required
                  placeholder="Event title"
                  className="w-full bg-transparent border-0 border-b outline-none text-[22px] font-bold pb-2 focus:border-white/40 transition-colors"
                  style={{
                    borderColor: 'var(--auth-card-border)',
                    color: 'var(--auth-text)',
                  }}
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap text-[12px]" style={helperStyle}>
                <span>sdgatx.com/events/</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                  placeholder="url-slug"
                  className="flex-1 min-w-[140px] px-2 py-1 rounded-[6px] text-[12px] outline-none border focus:border-white/30"
                  style={inputStyle}
                />
                {uploading && <span className="text-[11px]">Uploading image…</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="… or paste an image URL"
                  className="flex-1 min-w-[220px] px-3 py-1.5 rounded-[6px] text-[12px] outline-none border focus:border-white/30"
                  style={inputStyle}
                />
                {imageUrl && (
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    className="text-[11px] font-semibold tracking-[0.1em] px-3 py-1.5 rounded-full border transition-colors hover:bg-white/5"
                    style={{ borderColor: 'var(--auth-card-border)', color: 'var(--auth-muted)' }}
                  >
                    CLEAR
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* WHEN + WHAT — date, time, category on one compact card. */}
        <section className="rounded-[14px] border p-5" style={cardStyle}>
          <h3 className={sectionTitle} style={labelStyle}>When · What</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelClass} style={labelStyle}>Date</label>
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
              <label className={labelClass} style={labelStyle}>Time</label>
              <input
                type="text"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                placeholder="e.g. 10:00 PM"
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Category</label>
              <select
                value={category}
                onChange={handleCategoryChange}
                className={inputClass}
                style={inputStyle}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] mt-3" style={helperStyle}>
            Member discounts (Weekender / Experience) are configured on the Ticketing panel below.
          </p>
        </section>

        {/* DESCRIPTION */}
        <section className="rounded-[14px] border p-5" style={cardStyle}>
          <h3 className={sectionTitle} style={labelStyle}>Description</h3>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What is this event? Who's it for?"
            className={inputClass + ' resize-y'}
            style={inputStyle}
          />
        </section>

        {/* SETTINGS — visibility + event type, side-by-side segmented controls. */}
        <section className="rounded-[14px] border p-5" style={cardStyle}>
          <h3 className={sectionTitle} style={labelStyle}>Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className={labelClass} style={labelStyle}>Visibility</label>
              <Segmented
                value={isInternal ? 'internal' : 'public'}
                onChange={(v) => setIsInternal(v === 'internal')}
                options={[
                  { value: 'public', label: 'Public' },
                  { value: 'internal', label: 'Internal' },
                ]}
              />
              <p className="text-[11px] mt-2" style={helperStyle}>
                {isInternal
                  ? 'Hidden from the public events page — team calendar only.'
                  : 'Shown on the public events page and member surfaces.'}
              </p>
            </div>
            <div>
              <label className={labelClass} style={labelStyle}>Event Type</label>
              <Segmented
                value={eventType}
                onChange={setEventType}
                options={[
                  { value: 'public', label: 'Ticketed' },
                  { value: 'private', label: 'Private Rental' },
                ]}
              />
              <p className="text-[11px] mt-2" style={helperStyle}>
                {eventType === 'private'
                  ? 'Venue rental — no ticket sales for this event.'
                  : 'Sells tickets through the internal checkout below.'}
              </p>
            </div>
          </div>
          {isInternal && (
            <p className="text-[11px] mt-4" style={{ color: '#f59e0b' }}>
              Internal event: never appears on the public events page or member surfaces. It still
              supports contracts, SignNow, financials, and POS imports, and shows on the team calendar.
            </p>
          )}
        </section>

        {/* CONTACT / SDG-ONLY — required unless the event is fully internal. */}
        <section className="rounded-[14px] border p-5" style={cardStyle}>
          <h3 className={sectionTitle} style={labelStyle}>Organizer</h3>
          <EventContactFields
            isSdgOnly={isSdgOnly}
            onSdgOnlyChange={setIsSdgOnly}
            contactId={contactId}
            onContactIdChange={setContactId}
          />
        </section>

        {/* LEGACY TICKETTAILOR EVENT SERIES — only rendered for the two legacy
            events that still have a linked series. New events never see this. */}
        {isEditing && ttEventSeriesId ? (
          <section className="rounded-[14px] border p-5" style={cardStyle}>
            <TtLinkPanel eventId={event.id} initialSeriesId={ttEventSeriesId} metrics={metrics} />
          </section>
        ) : null}

        {error && (
          <div className="text-[13px] text-red-400 p-3 rounded-[10px] border border-red-500/30 bg-red-500/10">
            {error}
          </div>
        )}

        {/* Sticky action bar so save/cancel is always in reach on long pages. */}
        <div
          className="sticky bottom-4 z-10 rounded-full border px-4 py-3 flex items-center gap-3 backdrop-blur"
          style={{
            background: 'rgba(10, 10, 10, 0.85)',
            borderColor: 'var(--auth-card-border)',
          }}
        >
          <button
            type="submit"
            disabled={saving || uploading}
            className="flex-1 py-3 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            {saving ? 'SAVING…' : isEditing ? 'SAVE CHANGES' : 'CREATE EVENT'}
          </button>
          {canGenerateCodes && (
            <button
              type="button"
              onClick={handleGenerateCodes}
              disabled={generating}
              className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50 whitespace-nowrap"
              style={{
                border: '1px solid #ffb84d',
                color: '#ffb84d',
                background: 'transparent',
              }}
              title="Generate member ticket codes for this event"
            >
              {generating ? 'GENERATING…' : 'MEMBER CODES'}
            </button>
          )}
          <Link
            href="/bananas?tab=events"
            className="px-5 py-3 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            CANCEL
          </Link>
        </div>

        {generateMessage && (
          <p className="text-[12px] text-right" style={{ color: '#ffb84d' }}>
            {generateMessage}
          </p>
        )}
      </form>

      {footerPanels}
    </div>
  );
}
