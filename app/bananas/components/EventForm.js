'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import TtLinkPanel from './TtLinkPanel';
import EventContactFields from './EventContactFields';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import { CONTACT_REQUIRED_MESSAGE, ensureContactTaggedEventOrganizer } from '@/lib/contact-helpers';
import { uploadEventImage } from '@/lib/event-image-upload';

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
  // Event type: 'public' (Ticketed — sells tickets through internal checkout)
  // or 'private' (Private Rental — venue rental with no ticket sales).
  //
  // Default is always 'public' (Ticketed) unless the event was explicitly
  // marked as a private rental. There is no dedicated DB flag for private
  // rental yet, so we only fall to 'private' when a stored hint says so;
  // otherwise every event — new or existing — opens on Ticketed.
  const [eventType, setEventType] = useState(
    event?.event_type === 'private_rental' ? 'private' : 'public'
  );
  // Visibility has three tiers (see lib/event-visibility.js):
  //   * 'public'   — shown on the public /events page and member surfaces.
  //   * 'unlisted' — hidden from every listing, but /events/[slug] renders for
  //                  anyone with the link. Ticket checkout works. Used for
  //                  beta tests, invite-only nights, and private venue
  //                  rentals that still sell tickets through the site.
  //   * 'internal' — a "micro party" or team-only event: known only to
  //                  admin/team; appears on the team calendar and admin
  //                  dashboard but never publicly. Never renders at
  //                  /events/[slug].
  // Defaults to public. The form drives all three off a single `visibility`
  // string so the segmented control below stays a straight 1:1 mirror of the
  // saved value.
  const [visibility, setVisibility] = useState(event?.visibility || 'public');
  const isInternal = visibility === 'internal';
  const isUnlisted = visibility === 'unlisted';
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
  // Tier gate — restrict this event's notifications AND access to a single
  // membership tier. null = no tier gate (all members if is_sdg_only, else
  // public). Values map to member_profiles.subscription_plan.
  const [requiredTier, setRequiredTier] = useState(event?.required_membership_tier || '');
  // Weekender-tier flagship benefit: 25% off any event flagged as a Weekend
  // Music Experience. Admin sets this manually per
  // event — we don't auto-derive from category+date because a Friday yoga
  // class isn't a music event and a Wednesday DJ night isn't a weekend one.
  const [contactId, setContactId] = useState(event?.contact_id || null);
  // `ttEventSeriesId` is preserved so the two legacy TicketTailor events
  // (ubiyu 9/18, Groove Therapy 9/19) still round-trip their linked series
  // through save(). We don't expose a picker in the form anymore — the
  // legacy events edit their link via <TtLinkPanel> (server-side route).
  const [ttEventSeriesId] = useState(event?.tt_event_series_id || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Brief 'SAVED' pulse on the sticky bar after a successful edit save, so
  // the admin gets visible confirmation now that we no longer redirect them
  // to the events list on save. Cleared by a timer in handleSubmit.
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState('');
  const [recurrenceFreq, setRecurrenceFreq] = useState(event?.series?.recurrence_freq || 'none');
  const [recurrenceStartsOn, setRecurrenceStartsOn] = useState(event?.series?.starts_on || event?.event_date || '');
  const [recurrenceEndsOn, setRecurrenceEndsOn] = useState(event?.series?.ends_on || '');
  const showRecurrence = !isEditing || Boolean(event?.series_id);

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

    if (isEditing && eventDate !== event.event_date && Number(metrics?.orders_count || 0) > 0) {
      const count = Number(metrics.orders_count);
      const confirmed = window.confirm(
        `This event has ${count} paid order${count === 1 ? '' : 's'}. Changing the date will move those orders and their check-ins with it. If this is a recurring event, create the next occurrence from the series instead.`
      );
      if (!confirmed) return;
    }

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
      // event_type: 'micro_party' only for the internal tier; unlisted events
      // are still 'standard' — they behave like normal ticketed events, they
      // just aren't advertised.
      visibility,
      event_type: isInternal ? 'micro_party' : 'standard',
      is_sdg_only: isSdgOnly,
      // Tier gate only makes sense on member-scoped events. Clear it when
      // the event isn't SDG-only so we don't ship an inconsistent row.
      required_membership_tier: isSdgOnly && requiredTier ? requiredTier : null,
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

    if (recurrenceFreq !== 'none') {
      try {
        const recurrenceResponse = await fetch(`/api/admin/events/${saved.id}/series`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recurrence_freq: recurrenceFreq,
            starts_on: recurrenceStartsOn,
            ends_on: recurrenceEndsOn || null,
          }),
        });
        const recurrenceBody = await recurrenceResponse.json();
        if (!recurrenceResponse.ok) throw new Error(recurrenceBody?.error || 'Failed to save recurrence');
      } catch (recurrenceError) {
        setError(recurrenceError.message);
        setSaving(false);
        return;
      }
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

    // Editing: stay on this screen so the admin can keep working (e.g. Ticketing
    // panel, contract panel). Just refresh the server data and flash a brief
    // 'Saved' hint on the save button via the setSaving cycle + saveOk flag.
    // Creating: no id in the URL yet, so we DO route to the events list —
    // that's the only way to hand off to the newly-created event's edit page.
    if (isEditing) {
      setSaving(false);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 1800);
      router.refresh();
      return;
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
        // This form lives inside the admin shell (/bananas), which already
        // renders a theme toggle at the very top of the page. Suppress the
        // per-page one so we don't stack two identical switches.
        showThemeToggle={false}
      >
        {headerActions}
      </AuthenticatedPageHeader>

      {statusPanel}

      {/* VISIBILITY + EVENT TYPE strip — lives above the details cards so
          the top-of-page controls (STATUS → how it's shown / what it is)
          read as one contiguous decision bar before you get into details.
          Wired into the same form state; saved with the form. */}
      <section className="rounded-[14px] border p-5 mb-4" style={cardStyle}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className={labelClass} style={labelStyle}>Visibility</label>
            <Segmented
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'unlisted', label: 'Unlisted' },
                { value: 'internal', label: 'Internal' },
              ]}
            />
            <p className="text-[11px] mt-2" style={helperStyle}>
              {isInternal
                ? 'Hidden from every public surface — team calendar only.'
                : isUnlisted
                  ? 'Reachable only by the direct link. Not on /events, /home, or the public calendar.'
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
        {isUnlisted && (
          <p className="text-[11px] mt-4" style={{ color: '#f59e0b' }}>
            Unlisted event: not on /events, /home, or the public calendar, and search engines are
            told not to index it. Anyone with the /events/{slug || '[slug]'} link can open the page
            and buy tickets, so only share the link with people you want at the event.
          </p>
        )}
      </section>

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
                onChange={(e) => {
                  const nextDate = e.target.value;
                  setEventDate(nextDate);
                  if (!isEditing) setRecurrenceStartsOn(nextDate);
                }}
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
          <p className="text-[11px] mt-4" style={helperStyle}>
            Membership pricing \u2014 including whether this is a Weekend Music Experience \u2014 is set in
            the Member pricing panel below.
          </p>
        </section>

        {/* A series describes scheduling only: an occurrence edit never cascades
            to later rows, because those rows can already have their own sales. */}
        {showRecurrence && (
          <section className="rounded-[14px] border p-5" style={cardStyle}>
            <h3 className={sectionTitle} style={labelStyle}>Recurrence</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass} style={labelStyle}>Cadence</label>
                <select value={recurrenceFreq} onChange={(e) => setRecurrenceFreq(e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="none">None</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                </select>
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>First occurrence</label>
                <input type="date" value={recurrenceStartsOn} onChange={(e) => setRecurrenceStartsOn(e.target.value)} disabled={recurrenceFreq === 'none'} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>End date <span className="normal-case tracking-normal">(optional)</span></label>
                <input type="date" value={recurrenceEndsOn} onChange={(e) => setRecurrenceEndsOn(e.target.value)} disabled={recurrenceFreq === 'none'} min={recurrenceStartsOn || undefined} className={inputClass} style={inputStyle} />
              </div>
            </div>
            <p className="text-[11px] mt-3" style={helperStyle}>
              The weekday is taken from the first occurrence. New occurrences are generated as drafts for review. Changes here apply to this occurrence only.
            </p>
          </section>
        )}

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

        {/* TIER GATE — only meaningful on SDG-only events. Controls who
            gets the event_published notification (and, downstream, who can
            RSVP once tier-check is wired into ticket routes). */}
        {isSdgOnly ? (
          <section className="rounded-[14px] border p-5" style={cardStyle}>
            <h3 className={sectionTitle} style={labelStyle}>Member tier gate</h3>
            <p className="text-[12px] mb-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Restrict this event to a single membership tier. Leave as
              “All members” for a normal SDG-only drop.
            </p>
            <select
              value={requiredTier}
              onChange={(e) => setRequiredTier(e.target.value)}
              className="w-full rounded-[10px] border px-3 py-2 text-[14px]"
              style={{
                background: 'rgba(0,0,0,0.35)',
                borderColor: 'rgba(255,255,255,0.12)',
                color: '#e6e6e6',
              }}
            >
              <option value="">All members (any tier)</option>
              <option value="iykyk">The Insider only</option>
              <option value="cowork">The Builder only</option>
            </select>
          </section>
        ) : null}

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

        {/* Sticky action bar: matches the section cards above (same card bg,
            same border, same radius) so it reads as an extension of the form,
            not a random plank slapped on top. Buttons use the site's canonical
            primary style (auth-text-strong on auth-strong-surface-text) — the
            same pattern used across the admin. */}
        <div
          className="sticky bottom-4 z-10 flex items-center justify-end gap-2 px-4 py-3 rounded-[14px] border shadow-lg"
          style={{
            background: 'var(--auth-card-bg)',
            borderColor: 'var(--auth-card-border)',
          }}
        >
          <Link
            href="/bananas?tab=events"
            className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.14em] transition-colors hover:bg-black/5"
            style={{ color: 'var(--auth-muted)' }}
          >
            CANCEL
          </Link>
          {canGenerateCodes && (
            <button
              type="button"
              onClick={handleGenerateCodes}
              disabled={generating}
              className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.14em] border transition-colors hover:bg-black/5 disabled:opacity-50 whitespace-nowrap"
              style={{ color: '#c17800', borderColor: 'rgba(193, 120, 0, 0.35)' }}
              title="Generate member ticket codes for this event"
            >
              {generating ? 'GENERATING…' : 'MEMBER CODES'}
            </button>
          )}
          <button
            type="submit"
            disabled={saving || uploading}
            className="px-6 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{
              background: 'var(--auth-text-strong)',
              color: 'var(--auth-strong-surface-text)',
            }}
          >
            {saving ? 'SAVING…' : saveOk ? 'SAVED' : isEditing ? 'SAVE EVENT DETAILS' : 'CREATE EVENT'}
          </button>
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
