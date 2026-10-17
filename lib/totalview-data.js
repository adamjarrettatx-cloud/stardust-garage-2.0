// ---------------------------------------------------------------------------
// TotalView — server loader
// ---------------------------------------------------------------------------
// Reads every source TotalView summarises in one parallel fan-out and returns
// a compact payload: per-range numbers are computed here (lib/totalview.js),
// so the browser gets a few kilobytes rather than raw rows.
//
// Server-only. Uses the service-role client because TotalView aggregates
// across tables whose RLS is narrower than "any admin". The page runs
// adminPageGate() before calling this, and every money figure, the artist-pay
// queue and staff hours are only read when the caller may see the page they
// summarise (owner for Finances/Artist Pay, staff managers for Staff). Nothing
// here writes.
//
// Every source is independent and defensive: a failed or missing table makes
// that one number unavailable (rendered as a dash), never the whole page.

import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAdminCounts } from '@/lib/admin-counts';
import { HOMEPAGE_SIGNUP_SOURCE } from '@/lib/signups';
import {
  TOTALVIEW_LOOKBACK_MS,
  TOTALVIEW_LOOKAHEAD_MS,
  austinDate,
  metricAcrossRanges,
  shiftHourPoints,
  eventStatusLabel,
  eventNeedsContract,
  initials,
  daysLate,
  eventAdmissionCapacity,
} from '@/lib/totalview';

const PAGE_SIZE = 1000;
const MAX_PAGES = 60;

// Page through a query (PostgREST caps each response at 1000 rows). The
// builder must apply a total order so pages never overlap or skip.
async function fetchAllRows(build) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await build().range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || 'TotalView query failed');
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function safe(promiseFactory) {
  try {
    return { ok: true, data: await promiseFactory() };
  } catch {
    return { ok: false, data: [] };
  }
}

async function safeCount(builder) {
  try {
    const { count, error } = await builder;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

const PLAN_TO_TIER = {
  weekender: 'weekender',
  cowork: 'builder',
  'cowork-party': 'builder',
  iykyk: 'insider',
};

function trialEffectiveExpiry(p) {
  if (p.activated_at) {
    return [p.expires_at, p.extended_until].filter(Boolean)
      .sort((a, b) => Date.parse(a) - Date.parse(b)).pop() || null;
  }
  return p.signup_expires_at || null;
}

export async function loadTotalView({ supabase, isOwner = false, canManageStaff = false, nowMs = Date.now() }) {
  const admin = createAdminClient();
  const sinceIso = new Date(nowMs - TOTALVIEW_LOOKBACK_MS).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const untilIso = new Date(nowMs + TOTALVIEW_LOOKAHEAD_MS).toISOString();
  const today = austinDate(nowMs);
  const untilDate = austinDate(nowMs + TOTALVIEW_LOOKAHEAD_MS);

  const [
    counts,
    orders,
    refunds,
    tickets,
    doorIns,
    signups,
    trialsIssued,
    trialsLive,
    applications,
    newMembers,
    members,
    incidents,
    shifts,
    events,
    tasks,
    bookings,
    schedule,
    artistSets,
    failedRefunds,
    pendingHours,
    clockedIn,
    activeRestrictions,
    payQueue,
  ] = await Promise.all([
    fetchAdminCounts(supabase).catch(() => ({})),
    isOwner
      ? safe(() => fetchAllRows(() => admin.from('orders')
          .select('id, paid_at, total_cents')
          .in('status', ['paid', 'refunded', 'partial_refund'])
          .gte('paid_at', sinceIso)
          .order('paid_at').order('id')))
      : Promise.resolve({ ok: false, data: [] }),
    isOwner
      ? safe(() => fetchAllRows(() => admin.from('ticket_refund_requests')
          .select('id, created_at, applied_cents')
          .eq('status', 'succeeded')
          .gte('created_at', sinceIso)
          .order('created_at').order('id')))
      : Promise.resolve({ ok: false, data: [] }),
    // Paid tickets only: comps and free RSVPs are issued tickets but not sales.
    safe(() => fetchAllRows(() => admin.from('tickets')
      .select('id, issued_at, orders!inner(status, total_cents)')
      .in('orders.status', ['paid', 'refunded', 'partial_refund'])
      .gt('orders.total_cents', 0)
      .neq('status', 'void')
      .gte('issued_at', sinceIso)
      .order('issued_at').order('id'))),
    // Door entries = the live counter's check-ins (every door station feeds it).
    safe(() => fetchAllRows(() => admin.from('capacity_events')
      .select('id, created_at, delta')
      .eq('action', 'check_in')
      .gte('created_at', sinceIso)
      .order('created_at').order('id'))),
    safe(() => fetchAllRows(() => admin.from('signups')
      .select('id, created_at')
      .eq('source', HOMEPAGE_SIGNUP_SOURCE)
      .gte('created_at', sinceIso)
      .order('created_at').order('id'))),
    safe(() => fetchAllRows(() => admin.from('trial_passes')
      .select('id, issued_at, activated_at, applied_at, converted_at')
      .gte('issued_at', sinceIso)
      .order('issued_at').order('id'))),
    safe(() => fetchAllRows(() => admin.from('trial_passes')
      .select('id, activated_at, expires_at, extended_until, signup_expires_at')
      .is('converted_at', null)
      .neq('status', 'converted')
      .or(`expires_at.gt.${nowIso},extended_until.gt.${nowIso},signup_expires_at.gt.${nowIso}`)
      .order('id'))),
    safe(() => fetchAllRows(() => admin.from('membership_applications')
      .select('id, created_at')
      .gte('created_at', sinceIso)
      .order('created_at').order('id'))),
    safe(() => fetchAllRows(() => admin.from('member_profiles')
      .select('id, created_at')
      .gte('created_at', sinceIso)
      .order('created_at').order('id'))),
    safe(() => fetchAllRows(() => admin.from('member_profiles')
      .select('id, subscription_plan, subscription_status, cancel_at_period_end')
      .eq('is_active', true)
      .order('id'))),
    safe(() => fetchAllRows(() => admin.from('security_incidents')
      .select('id, created_at, action')
      .gte('created_at', sinceIso)
      .order('created_at').order('id'))),
    canManageStaff
      ? safe(() => fetchAllRows(() => admin.from('tc_shifts')
          .select('id, started_at, ended_at')
          .gte('started_at', sinceIso)
          .not('ended_at', 'is', null)
          .order('started_at').order('id')))
      : Promise.resolve({ ok: false, data: [] }),
    safe(() => fetchAllRows(() => admin.from('events')
      .select('id, title, event_date, event_time, status, visibility, event_type, series_id, ticketing_mode, tt_event_series_id, slug')
      .gte('event_date', today)
      .lte('event_date', untilDate)
      .order('event_date').order('id'))),
    safe(() => fetchAllRows(() => admin.from('project_tasks')
      .select('id, title, due_date, status, priority, assignee_id, department')
      .neq('status', 'done')
      .not('due_date', 'is', null)
      .lte('due_date', untilDate)
      .order('due_date').order('id'))),
    safe(() => fetchAllRows(() => admin.from('studio_bookings')
      .select('id, booking_date')
      .eq('status', 'confirmed')
      .gte('booking_date', today)
      .lte('booking_date', untilDate)
      .order('booking_date').order('id'))),
    canManageStaff
      ? safe(() => fetchAllRows(() => admin.from('tc_schedule')
          .select('id, starts_at')
          .gte('starts_at', nowIso)
          .lte('starts_at', untilIso)
          .order('starts_at').order('id')))
      : Promise.resolve({ ok: false, data: [] }),
    safe(() => fetchAllRows(() => admin.from('event_bookings')
      .select('id, event_id, slot_start, status')
      .neq('status', 'cancelled')
      .gte('slot_start', new Date(nowMs - 36 * 60 * 60 * 1000).toISOString())
      .lte('slot_start', untilIso)
      .order('slot_start').order('id'))),
    safeCount(admin.from('ticket_refund_requests').select('id', { count: 'exact', head: true }).eq('status', 'failed')),
    canManageStaff
      ? safeCount(admin.from('tc_shifts').select('id', { count: 'exact', head: true }).eq('status', 'pending'))
      : Promise.resolve(null),
    canManageStaff
      ? safeCount(admin.from('tc_shifts').select('id', { count: 'exact', head: true }).eq('status', 'open'))
      : Promise.resolve(null),
    safeCount(admin.from('access_restrictions').select('id', { count: 'exact', head: true })
      .is('lifted_at', null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)),
    isOwner
      ? safe(() => fetchAllRows(() => admin.from('artist_pay_requests')
          .select('id, amount_cents')
          .eq('status', 'pending_review')
          .order('id')))
      : Promise.resolve({ ok: false, data: [] }),
  ]);

  // --- Activity metrics -----------------------------------------------------
  const activity = {
    revenue: isOwner
      ? metricAcrossRanges(orders.data.map((o) => ({ at: o.paid_at, weight: o.total_cents || 0 })), nowMs, { available: orders.ok })
      : null,
    refunds: isOwner
      ? metricAcrossRanges(refunds.data.map((r) => ({ at: r.created_at, weight: r.applied_cents || 0 })), nowMs, { available: refunds.ok })
      : null,
    ticketsSold: metricAcrossRanges(tickets.data.map((t) => t.issued_at), nowMs, { available: tickets.ok }),
    doorEntries: metricAcrossRanges(doorIns.data.map((e) => ({ at: e.created_at, weight: Math.max(0, e.delta || 0) })), nowMs, { available: doorIns.ok }),
    signups: metricAcrossRanges(signups.data.map((s) => s.created_at), nowMs, { available: signups.ok }),
    trialsIssued: metricAcrossRanges(trialsIssued.data.map((t) => t.issued_at), nowMs, { available: trialsIssued.ok }),
    applications: metricAcrossRanges(applications.data.map((a) => a.created_at), nowMs, { available: applications.ok }),
    newMembers: metricAcrossRanges(newMembers.data.map((m) => m.created_at), nowMs, { available: newMembers.ok }),
    hoursLogged: canManageStaff
      ? metricAcrossRanges(shiftHourPoints(shifts.data), nowMs, { available: shifts.ok })
      : null,
    incidents: metricAcrossRanges(incidents.data.map((i) => i.created_at), nowMs, { available: incidents.ok }),
    bans: metricAcrossRanges(incidents.data.filter((i) => i.action === 'ban').map((i) => i.created_at), nowMs, { available: incidents.ok }),
  };

  // Trial funnel for passes issued inside each window: how far they got.
  const funnel = trialsIssued.ok
    ? {
        issued: metricAcrossRanges(trialsIssued.data.map((t) => t.issued_at), nowMs),
        activated: metricAcrossRanges(trialsIssued.data.filter((t) => t.activated_at).map((t) => t.issued_at), nowMs),
        applied: metricAcrossRanges(trialsIssued.data.filter((t) => t.applied_at).map((t) => t.issued_at), nowMs),
        converted: metricAcrossRanges(trialsIssued.data.filter((t) => t.converted_at).map((t) => t.issued_at), nowMs),
      }
    : null;

  // --- Events ahead ---------------------------------------------------------
  const eventRows = events.data;
  const eventIds = eventRows.map((e) => e.id);
  const contractIds = eventRows.filter(eventNeedsContract).map((e) => e.id);

  const [metrics, products, grants, contracts] = eventIds.length
    ? await Promise.all([
        safe(async () => (await admin.from('event_ticket_metrics')
          .select('event_id, tickets_sold, gross_cents').in('event_id', eventIds)).data || []),
        safe(async () => (await admin.from('ticket_products')
          .select('id, event_id, is_active, kind').in('event_id', eventIds)).data || []),
        safe(async () => (await admin.from('event_guestlist_grants')
          .select('id, event_id').in('event_id', eventIds)).data || []),
        contractIds.length
          ? safe(async () => (await admin.from('document_contracts')
              .select('event_id, document_id, status').eq('status', 'signed').in('event_id', contractIds)).data || [])
          : Promise.resolve({ ok: true, data: [] }),
      ])
    : [{ ok: true, data: [] }, { ok: true, data: [] }, { ok: true, data: [] }, { ok: true, data: [] }];

  // Admission products only: private spaces (the per-event Left Door room,
  // capacity 1) are rentals, not door capacity.
  const admissionProducts = products.data.filter((p) => p.is_active !== false && (p.kind || 'tickets') === 'tickets');
  const productIds = admissionProducts.map((p) => p.id);
  const grantIds = grants.data.map((g) => g.id);
  const docIds = Array.from(new Set(contracts.data.map((c) => c.document_id).filter(Boolean)));

  const [inventory, priceTiers, guestEntries, versions] = await Promise.all([
    productIds.length
      ? safe(async () => (await admin.from('ticket_inventory').select('product_id, capacity').in('product_id', productIds)).data || [])
      : Promise.resolve({ ok: true, data: [] }),
    productIds.length
      ? safe(async () => (await admin.from('ticket_price_tiers').select('product_id, quantity, status, sold_count').in('product_id', productIds)).data || [])
      : Promise.resolve({ ok: true, data: [] }),
    grantIds.length
      ? safe(() => fetchAllRows(() => admin.from('event_guestlist_entries').select('id, grant_id').in('grant_id', grantIds).order('id')))
      : Promise.resolve({ ok: true, data: [] }),
    docIds.length
      ? safe(async () => (await admin.from('document_versions').select('document_id').in('document_id', docIds)).data || [])
      : Promise.resolve({ ok: true, data: [] }),
  ]);

  const metricsByEvent = Object.fromEntries(metrics.data.map((m) => [m.event_id, m]));
  const capacityByEvent = (inventory.ok && priceTiers.ok)
    ? eventAdmissionCapacity(admissionProducts, inventory.data, priceTiers.data)
    : {};
  const grantEvent = Object.fromEntries(grants.data.map((g) => [g.id, g.event_id]));
  const guestsByEvent = {};
  for (const entry of guestEntries.data) {
    const eventId = grantEvent[entry.grant_id];
    if (eventId) guestsByEvent[eventId] = (guestsByEvent[eventId] || 0) + 1;
  }
  const docsWithFile = new Set(versions.data.map((v) => v.document_id));
  const signedEvents = new Set(
    contracts.data.filter((c) => c.document_id && docsWithFile.has(c.document_id)).map((c) => c.event_id)
  );
  const artistsByEvent = {};
  for (const set of artistSets.data) {
    artistsByEvent[set.event_id] = (artistsByEvent[set.event_id] || 0) + 1;
  }

  const upcomingEvents = eventRows.map((e) => {
    const ticketed = e.ticketing_mode === 'internal' || Boolean(e.tt_event_series_id);
    const m = metricsByEvent[e.id];
    return {
      id: e.id,
      title: e.title,
      date: e.event_date,
      time: e.event_time || '',
      status: eventStatusLabel(e),
      ticketed,
      sold: ticketed ? (m?.tickets_sold ?? null) : null,
      grossCents: ticketed && isOwner ? (m?.gross_cents ?? null) : null,
      capacity: ticketed ? (capacityByEvent[e.id] ?? null) : null,
      guestList: guestsByEvent[e.id] || 0,
      artists: artistsByEvent[e.id] || 0,
      contract: eventNeedsContract(e) ? (contracts.ok ? signedEvents.has(e.id) : null) : 'n/a',
    };
  });

  // --- Tasks ----------------------------------------------------------------
  const assigneeIds = Array.from(new Set(tasks.data.map((t) => t.assignee_id).filter(Boolean)));
  const assignees = assigneeIds.length
    ? await safe(async () => (await admin.from('team_members').select('id, full_name').in('id', assigneeIds)).data || [])
    : { ok: true, data: [] };
  const nameById = Object.fromEntries(assignees.data.map((a) => [a.id, a.full_name]));
  const taskRows = tasks.data.map((t) => ({
    id: t.id,
    title: t.title,
    due: t.due_date,
    late: daysLate(t.due_date, nowMs),
    priority: t.priority,
    status: t.status,
    assignee: nameById[t.assignee_id] || null,
    initials: nameById[t.assignee_id] ? initials(nameById[t.assignee_id]) : '—',
  }));

  // --- Right now ------------------------------------------------------------
  const tiers = { weekender: 0, builder: 0, insider: 0 };
  let activeMembers = 0;
  for (const m of members.data) {
    activeMembers += 1;
    const tier = PLAN_TO_TIER[m.subscription_plan];
    if (tier) tiers[tier] += 1;
  }

  const trialExpiries = trialsLive.data
    .map(trialEffectiveExpiry)
    .filter((at) => at && Date.parse(at) > nowMs);

  const payQueueCents = payQueue.data.reduce((sum, r) => sum + (r.amount_cents || 0), 0);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    nowMs,
    isOwner,
    canManageStaff,
    queues: {
      applications: counts.applications ?? null,
      payRequests: isOwner ? (payQueue.ok ? payQueue.data.length : counts.pendingPayRequests ?? null) : null,
      payRequestsCents: isOwner && payQueue.ok ? payQueueCents : null,
      conversations: counts.conversationsAwaitingTeam ?? null,
      venueInquiries: counts.venueInquiries ?? null,
      microParties: counts.microParties ?? null,
      collaborations: counts.collaborations ?? null,
      datePitches: counts.datePitches ?? null,
      pastDue: counts.pastDueMembers ?? null,
      newSignups: counts.newSignups ?? null,
      failedRefunds: failedRefunds,
      pendingHours: pendingHours,
    },
    activity,
    funnel,
    events: { ok: events.ok, rows: upcomingEvents },
    tasks: { ok: tasks.ok, rows: taskRows },
    ahead: {
      studioBookings: bookings.ok ? bookings.data.map((b) => b.booking_date) : null,
      shifts: canManageStaff && schedule.ok ? schedule.data.map((s) => s.starts_at) : null,
      trialExpiries: trialsLive.ok ? trialExpiries : null,
      artistSets: artistSets.ok ? artistSets.data.filter((s) => Date.parse(s.slot_start) >= nowMs).map((s) => s.slot_start) : null,
    },
    now: {
      activeMembers: members.ok ? activeMembers : null,
      tiers: members.ok ? tiers : null,
      trialsActive: trialsLive.ok ? trialExpiries.length : null,
      pastDue: counts.pastDueMembers ?? null,
      clockedIn: clockedIn,
      activeRestrictions: activeRestrictions,
      unreadChat: counts.unreadChat ?? null,
      unreadMentions: counts.unreadChatMentions ?? null,
    },
  };
}
