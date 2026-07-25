'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import TtLinkPanel from './TtLinkPanel';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

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

export default function EventForm({
  event,
  metrics = null,
  headerActions = null,
  topContent = null,
  backHref = '/bananas',
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
  const [ticketUrl, setTicketUrl] = useState(event?.ticket_url || '');
  const [category, setCategory] = useState(event?.category || 'other');
  const [memberDiscountPercent, setMemberDiscountPercent] = useState(
    event?.member_discount_percent != null ? String(event.member_discount_percent) : ''
  );
  const [ttEventSeriesId, setTtEventSeriesId] = useState(event?.tt_event_series_id || '');
  const [ttSeries, setTtSeries] = useState([]);
  const [ttSeriesError, setTtSeriesError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState('');

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

  const handleCategoryChange = (e) => {
    const newCategory = e.target.value;
    setCategory(newCategory);
    // Auto-fill the discount percent with the category default for qualifying
    // categories so admins start from the expected value.
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
      member_discount_percent:
        QUALIFYING_CATEGORIES.includes(category) && memberDiscountPercent.trim() !== ''
          ? Number(memberDiscountPercent)
          : null,
      // Internal micro-party events are hidden from the public /events page and
      // member surfaces but keep all internal capabilities (contracts, SignNow,
      // financials, POS). event_type labels the internal kind; visibility is the
      // access gate the public queries filter on.
      visibility: isInternal ? 'internal' : 'public',
      event_type: isInternal ? 'micro_party' : 'standard',
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

    router.push('/bananas');
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

  const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
  const labelStyle = { color: 'var(--auth-muted)' };
  const inputClass = 'w-full px-5 py-3.5 rounded-[10px] text-[14px] outline-none border transition-colors focus:border-white/30';
  const neutralToggleStyle = (active) => ({
    background: active ? 'var(--auth-text-strong)' : 'var(--auth-card-bg)',
    borderColor: active ? 'var(--auth-text-strong)' : 'var(--auth-card-border)',
    color: active ? 'var(--auth-strong-surface-text)' : 'var(--auth-text)',
  });
  const neutralToggleSubtext = (active) => ({
    color: active
      ? 'color-mix(in srgb, var(--auth-strong-surface-text) 72%, transparent)'
      : 'var(--auth-muted)',
  });

  return (
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[700px]"
      className="transition-colors duration-150"
      testId={isEditing ? 'route-bananas-events-id' : 'route-bananas-events-new-manual'}
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref={backHref}
        title={isEditing ? 'Edit Event' : 'New Event'}
        titleClassName="text-[36px]"
        right={headerActions}
      />

      {topContent}

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
          <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
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
            onChange={handleCategoryChange}
            className={inputClass}
            style={inputStyle}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                style={{ background: 'var(--auth-card-bg)', color: 'var(--auth-text)' }}
              >
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
            Workshop, Yoga, and Party events generate member discount codes automatically.
          </p>
        </div>

        {/* MEMBER DISCOUNT % - only for qualifying categories */}
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
              <span className="text-[14px]" style={{ color: 'var(--auth-muted)' }}>%</span>
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
              Default: Workshop 60%, Yoga 40%, Party 60%
            </p>
          </div>
        )}

        {/* TICKETTAILOR EVENT SERIES */}
        {isEditing ? (
          // For an existing event, link/unlink goes through the server route
          // (requireAdminMfa + server-side validation), not the client save.
          <TtLinkPanel eventId={event.id} initialSeriesId={ttEventSeriesId} metrics={metrics} />
        ) : (
          <div>
            <label className={labelClass} style={labelStyle}>TICKETTAILOR EVENT SERIES</label>
            {ttSeries.length > 0 ? (
              <select
                value={ttEventSeriesId}
                onChange={(e) => setTtEventSeriesId(e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                <option value="" style={{ background: 'var(--auth-card-bg)', color: 'var(--auth-text)' }}>
                  — None —
                </option>
                {ttSeries.map((s) => (
                  <option
                    key={s.id}
                    value={s.id}
                    style={{ background: 'var(--auth-card-bg)', color: 'var(--auth-text)' }}
                  >
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
            <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
              {ttSeriesError
                ? `Could not load series list (${ttSeriesError}). Enter the series ID manually.`
                : 'Link the TicketTailor event series so member discount codes apply to its tickets. You can verify the link after creating the event.'}
            </p>
          </div>
        )}

        {/* VISIBILITY TOGGLE — public vs internal micro party */}
        <div>
          <label className={labelClass} style={labelStyle}>VISIBILITY</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIsInternal(false)}
              className="py-4 px-5 rounded-[10px] border text-left transition-all"
              style={neutralToggleStyle(!isInternal)}
            >
              <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Public
              </div>
              <div className="text-[12px]" style={neutralToggleSubtext(!isInternal)}>
                Shown on the public events page
              </div>
            </button>
            <button
              type="button"
              onClick={() => setIsInternal(true)}
              className="py-4 px-5 rounded-[10px] border text-left transition-all"
              style={{
                background: isInternal ? '#f59e0b' : 'var(--auth-card-bg)',
                borderColor: isInternal ? '#f59e0b' : 'var(--auth-card-border)',
                color: isInternal ? '#0a0a0a' : 'var(--auth-text)',
              }}
            >
              <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Micro Party (Internal)
              </div>
              <div
                className="text-[12px]"
                style={{ color: isInternal ? 'rgba(10,10,10,0.72)' : 'var(--auth-muted)' }}
              >
                Hidden from public · team calendar only
              </div>
            </button>
          </div>
          {isInternal && (
            <p className="text-[11px] mt-2" style={{ color: '#f59e0b' }}>
              Internal micro party: never appears on the public events page or member surfaces. It still
              supports contracts, SignNow, financials, and POS imports, and shows on the team calendar.
            </p>
          )}
        </div>

        {/* EVENT TYPE TOGGLE */}
        <div>
          <label className={labelClass} style={labelStyle}>EVENT TYPE</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setEventType('public')}
              className="py-4 px-5 rounded-[10px] border text-left transition-all"
              style={neutralToggleStyle(eventType === 'public')}
            >
              <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Public Event
              </div>
              <div className="text-[12px]" style={neutralToggleSubtext(eventType === 'public')}>
                Sell tickets via link
              </div>
            </button>
            <button
              type="button"
              onClick={() => setEventType('private')}
              className="py-4 px-5 rounded-[10px] border text-left transition-all"
              style={neutralToggleStyle(eventType === 'private')}
            >
              <div className="text-[14px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Private Event
              </div>
              <div className="text-[12px]" style={neutralToggleSubtext(eventType === 'private')}>
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
            <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
              Link to Eventbrite, Shopify, Dice, etc. Leave blank if tickets are not yet available.
            </p>
          </div>
        )}

        <div>
          <label className={labelClass} style={labelStyle}>IMAGE</label>
          {imageUrl && (
            <div className="mb-3 rounded-[10px] overflow-hidden border" style={{ borderColor: 'var(--auth-card-border)' }}>
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
              style={{ color: 'var(--auth-muted)' }}
            />
            {uploading && <p className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>Uploading...</p>}
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Or paste an image URL"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <p className="text-[11px] mt-2" style={{ color: 'var(--auth-muted)' }}>
            Use a public image URL or upload a file to store it for the website event page.
          </p>
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
            className="auth-theme-solid-button flex-1 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
          >
            {saving ? 'SAVING...' : isEditing ? 'SAVE CHANGES' : 'CREATE EVENT'}
          </button>
          <Link
            href={backHref}
            className="auth-theme-border-button px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] border transition-colors hover:bg-white/5 flex items-center"
          >
            CANCEL
          </Link>
        </div>

        {canGenerateCodes && (
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={handleGenerateCodes}
              disabled={generating}
              className="self-start px-6 py-3 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
              style={{
                border: '1px solid var(--auth-accent)',
                color: 'var(--auth-accent)',
                background: 'transparent',
              }}
            >
              {generating ? 'GENERATING...' : 'GENERATE MEMBER CODES'}
            </button>
            {generateMessage && (
              <p className="text-[13px]" style={{ color: '#ffb84d' }}>
                {generateMessage}
              </p>
            )}
          </div>
        )}
      </form>
    </AuthenticatedPageSurface>
  );
}
