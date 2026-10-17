'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  TOTALVIEW_RANGES,
  TOTALVIEW_TIMEZONE,
  totalViewRange,
  describeChange,
  withinDateWindow,
  withinTimeWindow,
  austinDate,
} from '@/lib/totalview';
import s from './totalview.module.css';

// ---------------------------------------------------------------------------
// TotalView
// ---------------------------------------------------------------------------
// Reads top to bottom, one question per block:
//   1. Needs attention — queues waiting on the team right now
//   2. Coming up       — events, tasks and bookings in the next X
//   3. What happened   — activity in the last X vs the X before
//   4. Right now       — current totals
// The time-frame switch re-slices data already on the page, so changing it
// is instant; ?range= keeps the choice bookmarkable.

const STATUS_BADGE = {
  live: [s.bLive, 'Live'],
  draft: [s.bDraft, 'Draft'],
  secret: [s.bSecret, 'Secret'],
  internal: [s.bInternal, 'Internal'],
};

const TIER_COLORS = {
  weekender: 'var(--auth-text-strong)',
  builder: 'var(--auth-accent)',
  insider: 'var(--auth-violet)',
};

function fmtNumber(n, digits = 0) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtMoney(cents) {
  if (cents == null) return '—';
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function dateParts(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(),
    day: d.getUTCDate(),
    mon: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
  };
}

function dueLabel(dateStr, nowMs) {
  const today = austinDate(nowMs);
  const tomorrow = austinDate(nowMs + 24 * 60 * 60 * 1000);
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  const d = new Date(`${dateStr}T12:00:00Z`);
  const diffDays = Math.round((d - new Date(`${today}T12:00:00Z`)) / (24 * 60 * 60 * 1000));
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function Sparkline({ series, tone }) {
  if (!series?.length) return <svg className={s.spark} aria-hidden="true" />;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const stroke = tone === 'good' ? 'var(--auth-success)' : tone === 'bad' ? 'var(--auth-danger)' : 'var(--auth-muted)';
  const step = 140 / (series.length - 1 || 1);
  const points = series
    .map((v, i) => `${(i * step).toFixed(1)},${(26 - ((v - min) / (max - min || 1)) * 24).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={s.spark} viewBox="0 0 140 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SectionHead({ title, hint }) {
  return (
    <div className={s.secHead}>
      <h3 className={s.secTitle}>{title}</h3>
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

function AttentionItem({ item }) {
  return (
    <Link href={item.href} className={`${s.attItem} ${item.tone === 'red' ? s.red : s.amber}`}>
      <span className={s.attNum}>{fmtNumber(item.count)}</span>
      <span>
        <div className={s.attLabel}>{item.label}</div>
        <div className={s.attSub}>{item.sub}</div>
      </span>
      <span className={s.chev} aria-hidden="true">›</span>
    </Link>
  );
}

function Kpi({ kpi, range }) {
  const stats = kpi.metric?.[range.id];
  const value = stats?.value;
  const change = describeChange(value, stats?.prior);
  // For refunds and incidents, going up is the bad direction.
  const goodWhenUp = !kpi.lowerIsBetter;
  const tone = change.direction === 'flat' ? 'flat'
    : (change.direction === 'up') === goodWhenUp ? 'good' : 'bad';
  return (
    <Link href={kpi.href} className={s.kpi}>
      <div className={s.kpiLabel}>
        <span>{kpi.label}</span>
        {kpi.ownerOnly && <span className={s.lock}>OWNER</span>}
      </div>
      <div className={s.kpiValue}>{value == null ? '—' : kpi.format(value)}</div>
      <div className={s.kpiDelta}>
        {value == null ? 'Not available' : (
          <>
            <span className={tone === 'good' ? s.up : tone === 'bad' ? s.down : undefined}>{change.text}</span>
            {' '}vs prior {range.span}
          </>
        )}
      </div>
      <Sparkline series={stats?.series} tone={tone} />
    </Link>
  );
}

export default function TotalViewClient({ data, initialRange }) {
  const router = useRouter();
  const [rangeId, setRangeId] = useState(initialRange);
  const [refreshing, startRefresh] = useTransition();
  const range = totalViewRange(rangeId);
  const nowMs = data.nowMs;

  const chooseRange = useCallback((id) => {
    setRangeId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('range', id);
    window.history.replaceState(null, '', url);
  }, []);

  const updatedAt = useMemo(() => new Date(data.generatedAt).toLocaleString('en-US', {
    timeZone: TOTALVIEW_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }), [data.generatedAt]);

  // --- Coming up -----------------------------------------------------------
  const events = useMemo(
    () => data.events.rows.filter((e) => withinDateWindow(e.date, nowMs, range.ms)),
    [data.events.rows, nowMs, range.ms]
  );
  const overdue = useMemo(() => data.tasks.rows.filter((t) => t.late > 0).sort((a, b) => b.late - a.late), [data.tasks.rows]);
  const dueSoon = useMemo(
    () => data.tasks.rows.filter((t) => t.late <= 0 && withinDateWindow(t.due, nowMs, range.ms)),
    [data.tasks.rows, nowMs, range.ms]
  );

  const countDates = (list) => (list == null ? null : list.filter((d) => withinDateWindow(d, nowMs, range.ms)).length);
  const countTimes = (list) => (list == null ? null : list.filter((t) => withinTimeWindow(t, nowMs, range.ms)).length);
  const ahead = [
    { label: 'Studio bookings', value: countDates(data.ahead.studioBookings), href: '/bananas/studio-bookings' },
    data.canManageStaff && { label: 'Staff shifts scheduled', value: countTimes(data.ahead.shifts), href: '/bananas/staff' },
    { label: 'Artist sets booked', value: countTimes(data.ahead.artistSets), href: '/bananas?tab=events' },
    { label: 'Trial passes ending', value: countTimes(data.ahead.trialExpiries), href: '/team/trial-pass/analytics', warn: true },
  ].filter(Boolean);

  // --- Needs attention -------------------------------------------------------
  const q = data.queues;
  const noContract = events.filter((e) => e.contract === false);
  const notLive = events.filter((e) => e.status === 'draft');
  const oldestLate = overdue[0]?.late || 0;
  const attention = [
    { key: 'overdue', count: overdue.length, label: 'Overdue tasks', sub: oldestLate ? `Oldest ${plural(oldestLate, 'day')} late` : 'Past due date', href: '/team/progress', tone: 'red', clear: 'overdue tasks' },
    { key: 'contract', count: noContract.length, label: noContract.length === 1 ? 'Event without contract' : 'Events without contract', sub: `No signed contract · ${range.next}`, href: '/bananas?tab=events', tone: 'red', clear: 'contracts' },
    { key: 'draft', count: notLive.length, label: 'Events not live yet', sub: `Still draft · ${range.next}`, href: '/bananas?tab=events', tone: 'amber', clear: 'drafts' },
    { key: 'applications', count: q.applications, label: 'Applications', sub: 'Awaiting a decision', href: '/bananas/applications', tone: 'amber', clear: 'applications' },
    data.isOwner && { key: 'pay', count: q.payRequests, label: 'Artist pay requests', sub: q.payRequestsCents ? `${fmtMoney(q.payRequestsCents)} to review` : 'Awaiting review', href: '/bananas/pay-requests', tone: 'amber', clear: 'artist pay' },
    { key: 'conversations', count: q.conversations, label: 'Replies waiting', sub: 'Conversations need a reply', href: '/bananas/conversations', tone: 'amber', clear: 'conversations' },
    { key: 'venue', count: q.venueInquiries, label: 'Venue inquiries', sub: 'New, not yet handled', href: '/bananas/venue-inquiries', tone: 'amber', clear: 'venue inquiries' },
    { key: 'micro', count: q.microParties, label: 'Micro parties', sub: 'New booking requests', href: '/bananas/micro-parties', tone: 'amber', clear: 'micro parties' },
    { key: 'collabs', count: q.collaborations, label: 'Collaborations', sub: 'New partnership requests', href: '/bananas/collaborations', tone: 'amber', clear: 'collaborations' },
    { key: 'pitches', count: q.datePitches, label: 'Date pitches', sub: 'Pending review', href: '/bananas/date-pitches', tone: 'amber', clear: 'date pitches' },
    { key: 'pastdue', count: q.pastDue, label: 'Past-due members', sub: 'Payment failed', href: '/bananas/members', tone: 'amber', clear: 'past-due members' },
    { key: 'refunds', count: q.failedRefunds, label: 'Failed refunds', sub: 'Need another try', href: '/bananas/orders', tone: 'red', clear: 'refunds' },
    data.canManageStaff && { key: 'hours', count: q.pendingHours, label: 'Staff hours to review', sub: 'Ended shifts awaiting approval', href: '/bananas/staff', tone: 'amber', clear: 'staff hours' },
  ].filter(Boolean);
  const attentionOpen = attention.filter((a) => (a.count || 0) > 0);
  const attentionClear = attention.filter((a) => a.count === 0).map((a) => a.clear);

  // --- What happened -------------------------------------------------------
  const a = data.activity;
  const kpis = [
    data.isOwner && { key: 'revenue', label: 'Ticket revenue', metric: a.revenue, format: fmtMoney, href: '/bananas/sales', ownerOnly: true },
    { key: 'tickets', label: 'Tickets sold', metric: a.ticketsSold, format: fmtNumber, href: '/bananas/orders' },
    { key: 'door', label: 'Door entries', metric: a.doorEntries, format: fmtNumber, href: '/bananas/capacity' },
    { key: 'signups', label: 'New sign-ups', metric: a.signups, format: fmtNumber, href: '/bananas/signups' },
    { key: 'trials', label: 'Trial passes issued', metric: a.trialsIssued, format: fmtNumber, href: '/team/trial-pass/analytics' },
    { key: 'apps', label: 'Applications', metric: a.applications, format: fmtNumber, href: '/bananas/applications' },
    { key: 'members', label: 'New members', metric: a.newMembers, format: fmtNumber, href: '/bananas/members' },
    data.isOwner
      ? { key: 'refunds', label: 'Refunds', metric: a.refunds, format: fmtMoney, href: '/bananas/orders', ownerOnly: true, lowerIsBetter: true }
      : { key: 'incidents', label: 'Security incidents', metric: a.incidents, format: fmtNumber, href: '/bananas/capacity', lowerIsBetter: true },
    // Without the owner's revenue tile the grid would have a hole; staff
    // managers get hours, other admins get bans.
    !data.isOwner && (data.canManageStaff
      ? { key: 'hours', label: 'Hours logged', metric: a.hoursLogged, format: (v) => fmtNumber(v, 1), href: '/bananas/staff' }
      : { key: 'bans', label: 'Bans issued', metric: a.bans, format: fmtNumber, href: '/bananas/capacity', lowerIsBetter: true }),
  ].filter(Boolean);

  // --- Right now -----------------------------------------------------------
  const n = data.now;
  const tierTotal = n.tiers ? n.tiers.weekender + n.tiers.builder + n.tiers.insider : 0;
  const f = data.funnel;
  const fv = (metric) => metric?.[range.id]?.value ?? null;
  const issued = fv(f?.issued);
  const converted = fv(f?.converted);
  const incidentsNow = a.incidents?.[range.id]?.value;
  const bansNow = a.bans?.[range.id]?.value;

  const eventsSold = events.reduce((sum, e) => sum + (e.sold || 0), 0);
  const eventsGross = events.reduce((sum, e) => sum + (e.grossCents || 0), 0);
  const EVENT_LIMIT = 8;
  const TASK_LIMIT = 6;

  return (
    <div className={s.root}>
      <div className={s.top}>
        <div>
          <h2 className={s.title}>TotalView</h2>
          <div className={s.asof}>
            Updated {updatedAt} · Austin time ·{' '}
            <button
              type="button"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={refreshing}
              style={{ background: 'none', border: 0, padding: 0, color: 'var(--auth-muted-strong)', font: 'inherit', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className={s.seg} role="group" aria-label="Time frame">
          {TOTALVIEW_RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={r.id === range.id} onClick={() => chooseRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Needs attention */}
      <section className={s.sec}>
        <SectionHead title="Needs attention" hint="Waiting on the team right now · tap to open" />
        {attentionOpen.length ? (
          <>
            <div className={s.att}>
              {attentionOpen.map((item) => <AttentionItem key={item.key} item={item} />)}
            </div>
            {attentionClear.length > 0 && (
              <div className={s.clear}><b>All clear:</b> {attentionClear.join(', ')}</div>
            )}
          </>
        ) : (
          <div className={`${s.card} ${s.allClear}`}><b>All clear.</b> Nothing is waiting on the team.</div>
        )}
      </section>

      {/* 2. Coming up */}
      <section className={s.sec}>
        <SectionHead title={`Coming up · ${range.next}`} hint="Events, deadlines and bookings ahead" />
        <div className={s.two}>
          <div className={s.card}>
            <div className={s.cardHead}>
              <b>Events <span className={s.count}>· {events.length}</span></b>
              <Link href="/bananas?tab=events" className={s.cardLink}>Calendar ›</Link>
            </div>
            {!data.events.ok ? (
              <div className={s.empty}>Events could not be loaded. Try Refresh.</div>
            ) : events.length === 0 ? (
              <div className={s.empty}>No events in the {range.next}.</div>
            ) : (
              events.slice(0, EVENT_LIMIT).map((e) => {
                const d = dateParts(e.date);
                const [badgeClass, badgeLabel] = STATUS_BADGE[e.status] || STATUS_BADGE.live;
                const pct = e.capacity && e.sold != null ? Math.min(100, Math.round((e.sold / e.capacity) * 100)) : null;
                return (
                  <Link key={e.id} href={`/bananas/events/${e.id}`} className={s.evRow}>
                    <div className={s.date} aria-hidden="true">
                      <div className={s.dateDow}>{d.dow}</div>
                      <div className={s.dateDay}>{d.day}</div>
                      <div className={s.dateMon}>{d.mon}</div>
                    </div>
                    <div className={s.ev}>
                      <div className={s.evTitle}>{e.title}</div>
                      <div className={s.evMeta}>
                        <span className={`${s.badge} ${badgeClass}`}>{badgeLabel}</span>
                        {e.time && <span>{e.time}</span>}
                        <span>{plural(e.artists, 'artist')} booked</span>
                        {e.contract === true && <span className={s.ok}>✓ Contract signed</span>}
                        {e.contract === false && <span className={`${s.badge} ${s.bRed}`}>No signed contract</span>}
                      </div>
                    </div>
                    <div className={s.sales}>
                      {e.ticketed ? (
                        <>
                          <div className={s.salesTop}>
                            <span>{fmtNumber(e.sold ?? 0)}{e.capacity ? ` / ${fmtNumber(e.capacity)}` : ' sold'}</span>
                            <span>{pct != null ? `${pct}%` : ''}</span>
                          </div>
                          {pct != null && <div className={s.bar}><i style={{ width: `${pct}%` }} /></div>}
                          <div className={s.salesSub}>
                            {data.isOwner && e.grossCents != null ? `${fmtMoney(e.grossCents)} gross · ` : ''}
                            {plural(e.guestList, 'on guest list', 'on guest list')}
                          </div>
                        </>
                      ) : (
                        <div className={s.salesSub}>
                          Not ticketed{e.guestList ? ` · ${e.guestList} on guest list` : ''}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })
            )}
            {events.length > 0 && (
              <div className={s.foot}>
                <span>
                  {fmtNumber(eventsSold)} tickets sold
                  {data.isOwner ? ` · ${fmtMoney(eventsGross)} gross` : ''}
                  {events.length > EVENT_LIMIT ? ` · ${events.length - EVENT_LIMIT} more not shown` : ''}
                </span>
                <Link href="/bananas?tab=events" className={s.cardLink}>All events ›</Link>
              </div>
            )}
          </div>

          <div className={s.side}>
            <div className={s.card}>
              <div className={s.cardHead}>
                <b>Tasks due</b>
                <Link href="/team/progress" className={s.cardLink}>Tasks ›</Link>
              </div>
              {!data.tasks.ok ? (
                <div className={s.empty}>Tasks could not be loaded.</div>
              ) : (
                <>
                  {overdue.length > 0 && (
                    <>
                      <div className={s.subHead}>Overdue</div>
                      {overdue.slice(0, TASK_LIMIT).map((t) => (
                        <Link key={t.id} href="/team/progress" className={s.tk} title={t.assignee || 'Unassigned'}>
                          <span className={s.who}>{t.initials}</span>
                          <span className={s.tkTitle}>{t.title}</span>
                          <span className={`${s.when} ${s.late}`}>{t.late}d late</span>
                        </Link>
                      ))}
                      {overdue.length > TASK_LIMIT && <div className={s.more}>{overdue.length - TASK_LIMIT} more overdue</div>}
                    </>
                  )}
                  <div className={s.subHead}>Due in {range.next}</div>
                  {dueSoon.length === 0 ? (
                    <div className={s.empty} style={{ paddingTop: 6 }}>Nothing else due.</div>
                  ) : (
                    dueSoon.slice(0, TASK_LIMIT).map((t) => {
                      const label = dueLabel(t.due, nowMs);
                      return (
                        <Link key={t.id} href="/team/progress" className={s.tk} title={t.assignee || 'Unassigned'}>
                          <span className={s.who}>{t.initials}</span>
                          <span className={s.tkTitle}>{t.title}</span>
                          <span className={`${s.when} ${label === 'Today' ? s.soon : ''}`}>{label}</span>
                        </Link>
                      );
                    })
                  )}
                  {dueSoon.length > TASK_LIMIT && <div className={s.more}>{dueSoon.length - TASK_LIMIT} more due</div>}
                </>
              )}
            </div>

            <div className={s.card}>
              <div className={s.cardHead}><b>Also on the books</b></div>
              {ahead.map((row) => (
                <Link key={row.label} href={row.href} className={s.tk}>
                  <span className={s.tkTitle}>{row.label}</span>
                  <span className={`${s.when} ${row.warn && row.value ? s.soon : ''}`}>{fmtNumber(row.value)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 3. What happened */}
      <section className={s.sec}>
        <SectionHead title={`What happened · ${range.last}`} hint={`Compared with the ${range.span} before`} />
        <div className={s.kpis}>
          {kpis.map((kpi) => <Kpi key={kpi.key} kpi={kpi} range={range} />)}
        </div>
      </section>

      {/* 4. Right now */}
      <section className={s.sec}>
        <SectionHead title="Right now" hint="Current totals, plus the trial funnel for this time frame" />
        <div className={s.snap}>
          <div className={`${s.card} ${s.snapCard}`}>
            <h4 className={s.snapTitle}>Memberships <Link href="/bananas?tab=memberships" className={s.cardLink}>Open ›</Link></h4>
            <div className={s.stat}><span>Active members</span><b>{fmtNumber(n.activeMembers)}</b></div>
            {n.tiers && tierTotal > 0 && (
              <>
                <div className={s.stack} aria-hidden="true">
                  {['weekender', 'builder', 'insider'].map((tier) => (
                    <i key={tier} style={{ width: `${(n.tiers[tier] / tierTotal) * 100}%`, background: TIER_COLORS[tier] }} />
                  ))}
                </div>
                <div className={s.legend}>
                  <span><i className={s.dot} style={{ background: TIER_COLORS.weekender }} />Weekender {n.tiers.weekender}</span>
                  <span><i className={s.dot} style={{ background: TIER_COLORS.builder }} />Builder {n.tiers.builder}</span>
                  <span><i className={s.dot} style={{ background: TIER_COLORS.insider }} />Insider {n.tiers.insider}</span>
                </div>
              </>
            )}
            <div className={s.stat}><span>Trial passes active</span><b>{fmtNumber(n.trialsActive)}</b></div>
            <div className={s.stat}><span>Past due</span><b className={n.pastDue ? s.down : undefined}>{fmtNumber(n.pastDue)}</b></div>
          </div>

          <div className={`${s.card} ${s.snapCard}`}>
            <h4 className={s.snapTitle}>Trial pass funnel <Link href="/team/trial-pass/analytics" className={s.cardLink}>Open ›</Link></h4>
            <div className={s.snapNote}>People who got a pass in the {range.last}</div>
            <div className={s.funnel}>
              {[['Issued', f?.issued], ['Checked in', f?.activated], ['Applied', f?.applied], ['Member', f?.converted]].map(([label, metric]) => (
                <div key={label}><b>{fmtNumber(fv(metric))}</b><span>{label}</span></div>
              ))}
            </div>
            <div className={s.stat} style={{ marginTop: 10 }}>
              <span>Issued → member</span>
              <b>{issued ? `${Math.round((converted / issued) * 100)}%` : '—'}</b>
            </div>
            <div className={s.stat}><span>Sign-ups (homepage)</span><b>{fmtNumber(a.signups?.[range.id]?.value)}</b></div>
          </div>

          <div className={`${s.card} ${s.snapCard}`}>
            <h4 className={s.snapTitle}>
              Team &amp; door
              {data.canManageStaff && <Link href="/bananas/staff" className={s.cardLink}>Staff ›</Link>}
            </h4>
            {data.canManageStaff && <div className={s.stat}><span>Clocked in now</span><b>{fmtNumber(n.clockedIn)}</b></div>}
            {data.canManageStaff && (
              <div className={s.stat}><span>Hours logged · {range.last}</span><b>{fmtNumber(a.hoursLogged?.[range.id]?.value, 1)}</b></div>
            )}
            <div className={s.stat}>
              <span>Incidents · {range.last}</span>
              <b>{incidentsNow == null ? '—' : incidentsNow === 0 ? 'None' : `${incidentsNow}${bansNow ? ` · ${plural(bansNow, 'ban')}` : ''}`}</b>
            </div>
            <div className={s.stat}><span>Active restrictions</span><b>{fmtNumber(n.activeRestrictions)}</b></div>
            <div className={s.stat}>
              <span>Unread chat</span>
              <b>{fmtNumber(n.unreadChat)}{n.unreadMentions ? ` · ${n.unreadMentions} @you` : ''}</b>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
