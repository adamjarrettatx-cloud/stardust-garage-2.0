function dateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function nextOccurrenceDate(lastDate, recurrenceFreq, endsOn = null) {
  const validDate = dateOnly(lastDate);
  if (!validDate) return null;
  const days = recurrenceFreq === 'weekly' ? 7 : recurrenceFreq === 'biweekly' ? 14 : null;
  if (!days) return null;
  const next = addDays(validDate, days);
  return endsOn && next > endsOn ? null : next;
}

export function occurrenceSlug(templateSlug, occurrenceDate) {
  const suffix = `-${occurrenceDate}`;
  const base = String(templateSlug || 'event').replace(new RegExp(`${suffix}$`), '');
  return `${base}${suffix}`;
}

const EVENT_FIELDS = [
  'title', 'event_time', 'description', 'image_url', 'ticket_url', 'category',
  'discount_codes_generated', 'member_discount_percent',
  'event_end_time', 'visibility', 'event_type', 'contact_id', 'is_sdg_only',
  'ticketing_mode', 'booking_fee_cents_default', 'member_discount_percent_cowork',
  'member_discount_percent_iykyk', 'required_membership_tier',
  'is_weekend_music_experience',
  'member_discount_percent_weekender', 'member_discount_percent_trial',
];

export function buildNextOccurrenceEvent(template, { eventDate, seriesId, recurrencePosition, shareToken }) {
  const row = Object.fromEntries(EVENT_FIELDS.map((key) => [key, template[key] ?? null]));
  return {
    ...row,
    event_date: eventDate,
    slug: occurrenceSlug(template.slug, eventDate),
    share_token: shareToken,
    status: 'draft',
    series_id: seriesId,
    recurrence_position: recurrencePosition,
  };
}

const PRODUCT_FIELDS = [
  'name', 'description', 'sales_start_at', 'sales_end_at', 'min_per_order',
  'max_per_order', 'is_active', 'member_only', 'display_order',
  'tier_reveal_threshold', 'kind',
];

const TIER_FIELDS = [
  'name', 'price_cents', 'currency', 'starts_at', 'ends_at', 'display_order',
  'is_active', 'status', 'access_codes', 'booking_fee_cents_override', 'quantity',
];

export function buildNextTicketProductPayload(product, inventory, tiers, eventId) {
  return {
    product: {
      ...Object.fromEntries(PRODUCT_FIELDS.map((key) => [key, product[key] ?? null])),
      event_id: eventId,
    },
    inventory: inventory
      ? { capacity: inventory.capacity ?? null, sold: 0, reserved: 0 }
      : null,
    tiers: (tiers || []).map((tier) => Object.fromEntries(TIER_FIELDS.map((key) => [key, tier[key] ?? null]))),
  };
}
