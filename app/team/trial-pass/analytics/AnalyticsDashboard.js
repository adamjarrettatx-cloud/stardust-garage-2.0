'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import UnderlineTabs from '@/app/bananas/components/UnderlineTabs';

// Analytics dashboard for the trial pass program.
//
// Every color comes from the --auth-* CSS variables in lib/authenticated-theme.js
// so the dashboard follows the shell into whichever mode is active. The old
// version leaned on a set of substring overrides in globals.css that only fired
// on `background: #141414`-style inline styles; the cards still rendered dark
// even after the page was pulled into the shell, because the shell's outer
// frame is themed and the cards inside it were not.
//
// Layout:
//   Tabs: Overview | By event
//
//   Overview:
//     1. KPI cards (issued / active / applied / converted, plus 7d & 30d)
//     2. Funnel bar (issued -> checked in -> applied -> converted)
//     3. Two-column: source breakdown | denial reasons
//     4. Days-to-first-checkin histogram
//     5. Recent activity table
//
//   By event:
//     Left column: one card per event with a trial check-in (newest first),
//     showing the event date/title and unique allowed / rejected / denied
//     counts. Selecting a card opens the drill-down on the right with the
//     full attendee list for that event and a CSV export button so Adam
//     can pull the crowd from a specific night into follow-up outreach.

// The gold accent is the trial-pass brand mark. It reads well against both
// theme surfaces, so it stays a literal rather than a token.
const GOLD = 'var(--auth-accent, #ffb84d)';

function pct(rate) {
  if (!rate || Number.isNaN(rate)) return '0%';
  return `${Math.round(rate * 100)}%`;
}

const CARD_STYLE = {
  background: 'var(--auth-card-bg)',
  border: '1px solid var(--auth-card-border)',
};

const TRACK_STYLE = {
  background: 'var(--auth-card-bg-alt)',
};

function SignupIdentity({ row }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const initials = (row.fullName || '?').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-11 h-11 shrink-0 rounded-full overflow-hidden flex items-center justify-center text-[14px] font-semibold"
        style={{ background: 'var(--auth-card-bg-alt)', color: 'var(--auth-muted-strong)', border: '1px solid var(--auth-card-border)' }}
      >
        {row.photoUrl && row.photoUrl !== failedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.photoUrl} alt="" onError={() => setFailedUrl(row.photoUrl)} className="w-full h-full object-cover" />
        ) : initials}
      </div>
      <div>
        <div style={{ color: 'var(--auth-text)', fontWeight: 500 }}>{row.fullName}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--auth-muted)' }}>
          {row.email}
          {row.phone && <><span className="mx-1.5">·</span>{row.phone}</>}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, appliedAt, convertedAt, activationPhase }) {
  let label = status;
  let color = 'var(--auth-muted-strong)';
  if (convertedAt) {
    label = 'Member';
    color = 'var(--auth-success)';
  } else if (appliedAt) {
    label = 'Applied';
    color = GOLD;
  } else if (status === 'active' && activationPhase === 'unactivated') {
    // Signed up but never came out. The 30-day clock has not started.
    label = 'Ready to use';
    color = 'var(--auth-muted-strong)';
  } else if (status === 'active') {
    label = 'Active';
    color = 'var(--auth-text)';
  } else if (status === 'expired') {
    label = 'Expired';
    color = 'var(--auth-muted)';
  }
  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] uppercase px-2.5 py-1 rounded-full"
      style={{ color, ...TRACK_STYLE }}
    >
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl p-5" style={CARD_STYLE}>
      <div
        className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3"
        style={{ color: 'var(--auth-muted)' }}
      >
        {label}
      </div>
      <div
        className="text-[36px] font-extrabold -tracking-[0.02em] leading-none mb-1.5"
        style={{ color: 'var(--auth-text)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[12px]" style={{ color: 'var(--auth-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function FunnelBar({ funnel, rates }) {
  const stages = [
    { label: 'Passes issued', value: funnel.issued, rate: null },
    { label: 'Checked in at door', value: funnel.checkedIn, rate: rates.issuedToCheckin },
    { label: 'Applied for membership', value: funnel.applied, rate: rates.checkinToApplied },
    { label: 'Approved as member', value: funnel.converted, rate: rates.appliedToConverted },
  ];
  const max = Math.max(1, funnel.issued);

  return (
    <div className="rounded-2xl p-6 mb-10" style={CARD_STYLE}>
      <div
        className="text-[11px] font-semibold tracking-[0.2em] uppercase mb-5"
        style={{ color: 'var(--auth-muted)' }}
      >
        Conversion Funnel
      </div>
      <div className="space-y-4">
        {stages.map((stage, i) => {
          const width = (stage.value / max) * 100;
          return (
            <div key={stage.label}>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="text-[13px] font-medium" style={{ color: 'var(--auth-text)' }}>
                  {stage.label}
                </div>
                <div className="flex items-baseline gap-3">
                  {stage.rate !== null && (
                    <span className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>
                      {pct(stage.rate)} of prior step
                    </span>
                  )}
                  <span
                    className="text-[16px] font-bold"
                    style={{
                      color:
                        i === stages.length - 1 && stage.value > 0
                          ? 'var(--auth-success)'
                          : 'var(--auth-text)',
                    }}
                  >
                    {stage.value}
                  </span>
                </div>
              </div>
              <div
                className="h-2.5 rounded-full overflow-hidden"
                style={TRACK_STYLE}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${width}%`,
                    background: `linear-gradient(90deg, ${GOLD} 0%, color-mix(in srgb, ${GOLD} 55%, transparent) 100%)`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="mt-6 pt-5"
        style={{ borderTop: '1px solid var(--auth-card-border)' }}
      >
        <div className="flex items-baseline justify-between">
          <div
            className="text-[12px] tracking-[0.16em] uppercase font-semibold"
            style={{ color: 'var(--auth-muted)' }}
          >
            End-to-end conversion
          </div>
          <div className="text-[24px] font-extrabold" style={{ color: GOLD }}>
            {pct(rates.endToEnd)}
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownList({ title, rows, formatKey = (k) => k, emptyText = 'None yet.' }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="rounded-2xl p-6" style={CARD_STYLE}>
      <div
        className="text-[11px] font-semibold tracking-[0.2em] uppercase mb-5"
        style={{ color: 'var(--auth-muted)' }}
      >
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          {emptyText}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const key = r.source || r.reason || r.label;
            const share = total > 0 ? r.count / total : 0;
            return (
              <div key={key}>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="text-[13px]" style={{ color: 'var(--auth-text)' }}>
                    {formatKey(key)}
                  </div>
                  <div
                    className="text-[13px] font-semibold"
                    style={{ color: 'var(--auth-text)' }}
                  >
                    {r.count}
                    <span className="text-[11px] ml-2" style={{ color: 'var(--auth-muted)' }}>
                      {pct(share)}
                    </span>
                  </div>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={TRACK_STYLE}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${share * 100}%`, background: GOLD }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatSource(key) {
  const map = {
    trial_pass_qr: 'Self-serve QR',
    front_desk_manual: 'Front-desk manual',
    unknown: 'Unknown',
  };
  return map[key] || key;
}

function formatDenialReason(key) {
  const map = {
    not_found: 'Pass not found',
    expired: 'Pass expired',
    revoked: 'Pass revoked',
    unknown: 'Unspecified',
  };
  return map[key] || key.replace(/_/g, ' ');
}

function DaysHistogram({ buckets }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div className="rounded-2xl p-6" style={CARD_STYLE}>
      <div
        className="text-[11px] font-semibold tracking-[0.2em] uppercase mb-1"
        style={{ color: 'var(--auth-muted)' }}
      >
        First check-in timing
      </div>
      <div className="text-[12px] mb-5" style={{ color: 'var(--auth-muted)' }}>
        Days between issue and first door check-in.{' '}
        {total > 0 ? `${total} checked-in passes.` : ''}
      </div>
      <div className="flex items-end gap-3 h-[140px]">
        {buckets.map((b) => {
          const height = (b.count / max) * 100;
          return (
            <div key={b.label} className="flex-1 flex flex-col items-center gap-2">
              <div className="text-[11px] font-semibold" style={{ color: 'var(--auth-text)' }}>
                {b.count}
              </div>
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${Math.max(4, height)}%`,
                  background: `linear-gradient(180deg, ${GOLD} 0%, color-mix(in srgb, ${GOLD} 40%, transparent) 100%)`,
                }}
              />
              <div
                className="text-[10px] font-semibold tracking-[0.06em] uppercase text-center"
                style={{ color: 'var(--auth-muted)' }}
              >
                {b.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentTable({ rows }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={CARD_STYLE}>
      <div
        className="px-6 py-5 text-[11px] font-semibold tracking-[0.2em] uppercase"
        style={{
          color: 'var(--auth-muted)',
          borderBottom: '1px solid var(--auth-card-border)',
        }}
      >
        Recent Trial Members
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          No passes issued yet. Once the first guest scans a QR, they show up here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: 'var(--auth-muted)' }}>
                <th className="text-left font-semibold px-6 py-3">Name</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
                <th className="text-left font-semibold px-4 py-3">Source</th>
                <th className="text-right font-semibold px-4 py-3">Check-ins</th>
                <th className="text-right font-semibold px-4 py-3">Days left</th>
                <th className="text-right font-semibold px-6 py-3">Issued</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderTop: '1px solid var(--auth-row-border, var(--auth-card-border))' }}
                >
                  <td className="px-6 py-3.5">
                    <SignupIdentity row={r} />
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusPill
                      status={r.status}
                      appliedAt={r.appliedAt}
                      convertedAt={r.convertedAt}
                      activationPhase={r.activationPhase}
                    />
                  </td>
                  <td className="px-4 py-3.5" style={{ color: 'var(--auth-text)' }}>
                    {formatSource(r.signupSource)}
                  </td>
                  <td
                    className="px-4 py-3.5 text-right"
                    style={{ color: 'var(--auth-text)', fontWeight: 600 }}
                  >
                    {r.checkinCount}
                  </td>
                  <td className="px-4 py-3.5 text-right" style={{ color: 'var(--auth-text)' }}>
                    {r.status === 'active' ? `${r.daysLeft}d` : '—'}
                  </td>
                  <td className="px-6 py-3.5 text-right" style={{ color: 'var(--auth-muted)' }}>
                    {new Date(r.issuedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// By-event tab
// -----------------------------------------------------------------------------

function formatEventDate(dateStr, timeStr) {
  if (!dateStr) return 'Undated';
  // Event dates are stored as YYYY-MM-DD without a timezone. Parsing directly
  // with new Date('2026-09-20') anchors to UTC midnight and prints as "Sep 19"
  // in Central Time, so we split and construct in the local zone instead.
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  const base = dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: dt.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
  if (!timeStr) return base;
  // event_time is 'HH:MM:SS'. Trim seconds; a 24h -> 12h render matches the
  // rest of the admin surfaces without pulling in a full date library.
  const [hh, mm] = timeStr.split(':').map(Number);
  if (Number.isNaN(hh)) return base;
  const suffix = hh >= 12 ? 'pm' : 'am';
  const h12 = ((hh + 11) % 12) + 1;
  const mmStr = mm ? `:${String(mm).padStart(2, '0')}` : '';
  return `${base} · ${h12}${mmStr}${suffix}`;
}

function formatScannedAt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function EventListCard({ event, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className="w-full text-left rounded-2xl p-5 transition-colors"
      style={{
        background: active ? 'var(--auth-hover-bg)' : 'var(--auth-card-bg)',
        border: `1px solid ${active ? GOLD : 'var(--auth-card-border)'}`,
        cursor: 'pointer',
      }}
    >
      <div
        className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-2"
        style={{ color: 'var(--auth-muted)' }}
      >
        {event.eventDate
          ? formatEventDate(event.eventDate, event.eventTime)
          : 'Outside any event window'}
      </div>
      <div
        className="text-[16px] font-bold leading-tight mb-3"
        style={{ color: 'var(--auth-text)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {event.title}
      </div>
      <div className="flex items-baseline gap-4 text-[12px]">
        <div>
          <span
            className="text-[18px] font-extrabold mr-1"
            style={{ color: 'var(--auth-text)' }}
          >
            {event.signupCount}
          </span>
          <span style={{ color: 'var(--auth-muted)' }}>
            signup{event.signupCount === 1 ? '' : 's'}
          </span>
        </div>
        {event.checkedInCount > 0 && (
          <div style={{ color: 'var(--auth-muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--auth-text)' }}>
              {event.checkedInCount}
            </span>{' '}
            checked in
          </div>
        )}
        {event.rejectedCount > 0 && (
          <div style={{ color: 'var(--auth-muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--auth-text)' }}>
              {event.rejectedCount}
            </span>{' '}
            rejected
          </div>
        )}
      </div>
    </button>
  );
}

function FollowUpPill({ appliedAt, convertedAt }) {
  if (convertedAt) {
    return (
      <span
        className="inline-block text-[10px] font-semibold tracking-[0.14em] uppercase px-2 py-0.5 rounded-full"
        style={{ color: 'var(--auth-success)', background: 'var(--auth-card-bg-alt)' }}
      >
        Member
      </span>
    );
  }
  if (appliedAt) {
    return (
      <span
        className="inline-block text-[10px] font-semibold tracking-[0.14em] uppercase px-2 py-0.5 rounded-full"
        style={{ color: GOLD, background: 'var(--auth-card-bg-alt)' }}
      >
        Applied
      </span>
    );
  }
  return (
    <span className="text-[11px]" style={{ color: 'var(--auth-muted)' }}>
      —
    </span>
  );
}

function EventSignupsPanel({ event }) {
  if (!event) {
    return (
      <div className="rounded-2xl p-6" style={CARD_STYLE}>
        <div className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          Select an event on the left to see who signed up during it.
        </div>
      </div>
    );
  }

  const exportHref = event.eventId
    ? `/api/team/trial-pass/analytics/event/${event.eventId}/export`
    : `/api/team/trial-pass/analytics/event/none/export`;

  const summaryBits = [`${event.signupCount} signups`];
  if (event.checkedInCount > 0) summaryBits.push(`${event.checkedInCount} checked in`);
  if (event.rejectedCount > 0) summaryBits.push(`${event.rejectedCount} rejected`);

  return (
    <div className="rounded-2xl overflow-hidden" style={CARD_STYLE}>
      <div
        className="px-6 py-5 flex items-start justify-between gap-4"
        style={{ borderBottom: '1px solid var(--auth-card-border)' }}
      >
        <div className="min-w-0">
          <div
            className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-1.5"
            style={{ color: 'var(--auth-muted)' }}
          >
            {event.eventDate
              ? formatEventDate(event.eventDate, event.eventTime)
              : 'Outside any event window'}
          </div>
          <div
            className="text-[20px] font-extrabold leading-tight truncate"
            style={{ color: 'var(--auth-text)', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {event.title}
          </div>
          <div className="text-[12px] mt-2" style={{ color: 'var(--auth-muted)' }}>
            {summaryBits.join(' · ')}
          </div>
        </div>
        {event.signups.length > 0 && (
          <a
            href={exportHref}
            download
            className="flex-shrink-0 text-[12px] font-semibold px-3.5 py-2 rounded-lg transition-colors"
            style={{
              color: 'var(--auth-text)',
              background: 'var(--auth-card-bg-alt)',
              border: '1px solid var(--auth-card-border)',
            }}
          >
            Export CSV
          </a>
        )}
      </div>

      {event.signups.length === 0 ? (
        <div className="p-6 text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          No trial passes were signed up during this event&apos;s window.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: 'var(--auth-muted)' }}>
                <th className="text-left font-semibold px-6 py-3">Name</th>
                <th className="text-left font-semibold px-4 py-3">Source</th>
                <th className="text-left font-semibold px-4 py-3">Follow-up</th>
                <th className="text-right font-semibold px-4 py-3">Signed up</th>
                <th className="text-right font-semibold px-6 py-3">Checked in</th>
              </tr>
            </thead>
            <tbody>
              {event.signups.map((s) => (
                <tr
                  key={s.passId}
                  style={{ borderTop: '1px solid var(--auth-row-border, var(--auth-card-border))' }}
                >
                  <td className="px-6 py-3.5">
                    <SignupIdentity row={s} />
                  </td>
                  <td className="px-4 py-3.5" style={{ color: 'var(--auth-text)' }}>
                    {formatSource(s.signupSource)}
                  </td>
                  <td className="px-4 py-3.5">
                    <FollowUpPill appliedAt={s.appliedAt} convertedAt={s.convertedAt} />
                  </td>
                  <td className="px-4 py-3.5 text-right" style={{ color: 'var(--auth-muted)' }}>
                    {formatScannedAt(s.issuedAt)}
                  </td>
                  <td className="px-6 py-3.5 text-right" style={{ color: 'var(--auth-muted)' }}>
                    {s.checkedInAt ? formatScannedAt(s.checkedInAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ByEventTab({ byEvent }) {
  // Show only events that had at least one signup (or check-in) plus the
  // Unattributed bucket if it exists. A months-old event with zero of both
  // is not useful noise on this tab.
  const visible = useMemo(
    () =>
      byEvent.filter(
        (e) =>
          e.signupCount > 0 ||
          e.checkedInCount > 0 ||
          e.rejectedCount > 0 ||
          e.deniedCount > 0 ||
          e.eventId === null,
      ),
    [byEvent],
  );

  // Pick the newest real event by default so opening the tab lands on the
  // most useful view; user can click any other event or the Unattributed row.
  const initialId = useMemo(() => {
    const withEvent = visible.find((e) => e.eventId);
    return (withEvent || visible[0])?.eventId || null;
  }, [visible]);

  const [selectedId, setSelectedId] = useState(initialId);

  if (visible.length === 0) {
    return (
      <div className="rounded-2xl p-6" style={CARD_STYLE}>
        <div className="text-[13px]" style={{ color: 'var(--auth-muted)' }}>
          No trial-pass signups or check-ins yet. Once guests start signing up
          during an event window, that event will show up here.
        </div>
      </div>
    );
  }

  const selected =
    visible.find((e) => (e.eventId || '__none__') === (selectedId || '__none__')) || visible[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-4">
      <div className="space-y-3">
        {visible.map((e) => (
          <EventListCard
            key={e.eventId || '__none__'}
            event={e}
            active={(e.eventId || '__none__') === (selected.eventId || '__none__')}
            onSelect={(next) => setSelectedId(next.eventId)}
          />
        ))}
      </div>
      <EventSignupsPanel event={selected} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Dashboard shell
// -----------------------------------------------------------------------------

export default function AnalyticsDashboard({ data }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(refresh, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [router]);

  const { totals, funnel, rates, sourceBreakdown, denialReasons, dayBuckets, recent, byEvent } =
    data;

  const [tab, setTab] = useState('overview');

  // Only counting events that had signup activity (or the Unattributed
  // bucket) so the tab's count chip matches what the user sees on the tab.
  const byEventVisibleCount = (byEvent || []).filter(
    (e) => e.signupCount > 0 || e.checkedInCount > 0 || e.eventId === null,
  ).length;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'by-event', label: 'Signups by event', count: byEventVisibleCount },
  ];

  return (
    <>
      <UnderlineTabs
        tabs={tabs}
        active={tab}
        onChange={setTab}
        ariaLabel="Analytics view"
        testId="trial-pass-analytics-tabs"
      />

      {tab === 'by-event' ? (
        <ByEventTab byEvent={byEvent || []} />
      ) : (
        <OverviewTab
          totals={totals}
          funnel={funnel}
          rates={rates}
          sourceBreakdown={sourceBreakdown}
          denialReasons={denialReasons}
          dayBuckets={dayBuckets}
          recent={recent}
        />
      )}
    </>
  );
}

function OverviewTab({ totals, funnel, rates, sourceBreakdown, denialReasons, dayBuckets, recent }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <KpiCard
          label="Passes issued"
          value={totals.all}
          sub={`${totals.last7} in last 7d · ${totals.last30} in last 30d`}
        />
        <KpiCard
          label="Ready to use"
          value={totals.activeUnactivated}
          sub="Signed up, not yet visited"
        />
        <KpiCard
          label="In 30-day window"
          value={totals.activeActivated}
          sub="Activated on first visit"
        />
        <KpiCard
          label="Applied"
          value={totals.applied}
          sub={
            rates.issuedToCheckin > 0
              ? `${pct(rates.checkinToApplied)} of check-ins`
              : 'Awaiting apps'
          }
        />
        <KpiCard
          label="Approved members"
          value={totals.converted}
          sub={
            totals.converted > 0
              ? `${pct(rates.endToEnd)} end-to-end conversion`
              : 'None yet'
          }
        />
      </div>

      <FunnelBar funnel={funnel} rates={rates} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <BreakdownList
          title="Signup source"
          rows={sourceBreakdown}
          formatKey={formatSource}
          emptyText="No passes issued yet."
        />
        <BreakdownList
          title="Door denial reasons"
          rows={denialReasons}
          formatKey={formatDenialReason}
          emptyText="No denials yet — every scan has been let in."
        />
      </div>

      <div className="mb-8">
        <DaysHistogram buckets={dayBuckets} />
      </div>

      <RecentTable rows={recent} />
    </>
  );
}
