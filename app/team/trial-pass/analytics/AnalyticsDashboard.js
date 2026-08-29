'use client';

// Analytics dashboard for the trial pass program.
//
// Server-rendered on load with data pulled by loadTrialPassAnalytics(). This
// component is client-only so it can drive interactive charts and a "refresh"
// button without a full page reload (a future improvement \u2014 for now the page
// is force-dynamic so every visit rehydrates fresh).
//
// Layout:
//   1. KPI cards (issued / active / applied / converted, plus 7d & 30d)
//   2. Funnel bar (issued \u2192 checked in \u2192 applied \u2192 converted)
//   3. Two-column: source breakdown | denial reasons
//   4. Days-to-first-checkin histogram
//   5. Recent activity table

const GOLD = '#ffb84d';
const CREAM = 'rgba(255,255,255,0.85)';
const DIM = 'rgba(255,255,255,0.55)';
const CARD = 'rgba(255,255,255,0.04)';
const CARD_BORDER = 'rgba(255,255,255,0.08)';

function pct(rate) {
  if (!rate || Number.isNaN(rate)) return '0%';
  return `${Math.round(rate * 100)}%`;
}

function StatusPill({ status, appliedAt, convertedAt }) {
  let label = status;
  let color = DIM;
  let bg = 'rgba(255,255,255,0.05)';
  if (convertedAt) {
    label = 'Member';
    color = '#4ade80';
    bg = 'rgba(74,222,128,0.12)';
  } else if (appliedAt) {
    label = 'Applied';
    color = GOLD;
    bg = 'rgba(255,184,77,0.15)';
  } else if (status === 'active') {
    label = 'Active';
    color = '#ffffff';
    bg = 'rgba(255,255,255,0.08)';
  } else if (status === 'expired') {
    label = 'Expired';
    color = DIM;
    bg = 'rgba(255,255,255,0.04)';
  }
  return (
    <span
      className="inline-block text-[10px] font-semibold tracking-[0.14em] uppercase px-2.5 py-1 rounded-full"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}
    >
      <div
        className="text-[10px] font-semibold tracking-[0.2em] uppercase mb-3"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div
        className="text-[36px] font-extrabold -tracking-[0.02em] leading-none mb-1.5"
        style={{ color: '#ffffff', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[12px]" style={{ color: DIM }}>
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
    <div
      className="rounded-2xl p-6 mb-10"
      style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}
    >
      <div
        className="text-[11px] font-semibold tracking-[0.2em] uppercase mb-5"
        style={{ color: DIM }}
      >
        Conversion Funnel
      </div>
      <div className="space-y-4">
        {stages.map((stage, i) => {
          const width = (stage.value / max) * 100;
          return (
            <div key={stage.label}>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="text-[13px] font-medium" style={{ color: CREAM }}>
                  {stage.label}
                </div>
                <div className="flex items-baseline gap-3">
                  {stage.rate !== null && (
                    <span className="text-[11px]" style={{ color: DIM }}>
                      {pct(stage.rate)} of prior step
                    </span>
                  )}
                  <span
                    className="text-[16px] font-bold"
                    style={{
                      color: i === stages.length - 1 && stage.value > 0 ? '#4ade80' : '#ffffff',
                    }}
                  >
                    {stage.value}
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${width}%`,
                    background: `linear-gradient(90deg, ${GOLD} 0%, rgba(255,184,77,0.55) 100%)`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
        <div className="flex items-baseline justify-between">
          <div className="text-[12px] tracking-[0.16em] uppercase font-semibold" style={{ color: DIM }}>
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
    <div
      className="rounded-2xl p-6"
      style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}
    >
      <div
        className="text-[11px] font-semibold tracking-[0.2em] uppercase mb-5"
        style={{ color: DIM }}
      >
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-[13px]" style={{ color: DIM }}>
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
                  <div className="text-[13px]" style={{ color: CREAM }}>
                    {formatKey(key)}
                  </div>
                  <div className="text-[13px] font-semibold" style={{ color: '#ffffff' }}>
                    {r.count}
                    <span className="text-[11px] ml-2" style={{ color: DIM }}>
                      {pct(share)}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
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
    <div
      className="rounded-2xl p-6"
      style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}
    >
      <div
        className="text-[11px] font-semibold tracking-[0.2em] uppercase mb-1"
        style={{ color: DIM }}
      >
        First check-in timing
      </div>
      <div className="text-[12px] mb-5" style={{ color: DIM }}>
        Days between issue and first door check-in.{' '}
        {total > 0 ? `${total} checked-in passes.` : ''}
      </div>
      <div className="flex items-end gap-3 h-[140px]">
        {buckets.map((b) => {
          const height = (b.count / max) * 100;
          return (
            <div key={b.label} className="flex-1 flex flex-col items-center gap-2">
              <div className="text-[11px] font-semibold" style={{ color: '#ffffff' }}>
                {b.count}
              </div>
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${Math.max(4, height)}%`,
                  background: `linear-gradient(180deg, ${GOLD} 0%, rgba(255,184,77,0.4) 100%)`,
                }}
              />
              <div
                className="text-[10px] font-semibold tracking-[0.06em] uppercase text-center"
                style={{ color: DIM }}
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
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}
    >
      <div
        className="px-6 py-5 text-[11px] font-semibold tracking-[0.2em] uppercase"
        style={{ color: DIM, borderBottom: `1px solid ${CARD_BORDER}` }}
      >
        Recent Trial Members
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-[13px]" style={{ color: DIM }}>
          No passes issued yet. Once the first guest scans a QR, they show up here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: DIM }}>
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
                <tr key={r.id} style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                  <td className="px-6 py-3.5">
                    <div style={{ color: '#ffffff', fontWeight: 500 }}>{r.fullName}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: DIM }}>
                      {r.email}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusPill
                      status={r.status}
                      appliedAt={r.appliedAt}
                      convertedAt={r.convertedAt}
                    />
                  </td>
                  <td className="px-4 py-3.5" style={{ color: CREAM }}>
                    {formatSource(r.signupSource)}
                  </td>
                  <td className="px-4 py-3.5 text-right" style={{ color: '#ffffff', fontWeight: 600 }}>
                    {r.checkinCount}
                  </td>
                  <td className="px-4 py-3.5 text-right" style={{ color: CREAM }}>
                    {r.status === 'active' ? `${r.daysLeft}d` : '—'}
                  </td>
                  <td className="px-6 py-3.5 text-right" style={{ color: DIM }}>
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

export default function AnalyticsDashboard({ data }) {
  const { totals, funnel, rates, sourceBreakdown, denialReasons, dayBuckets, recent } = data;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Passes issued"
          value={totals.all}
          sub={`${totals.last7} in last 7d · ${totals.last30} in last 30d`}
        />
        <KpiCard label="Active" value={totals.active} sub="Within the 30-day window" />
        <KpiCard
          label="Applied"
          value={totals.applied}
          sub={rates.issuedToCheckin > 0 ? `${pct(rates.checkinToApplied)} of check-ins` : 'Awaiting apps'}
        />
        <KpiCard
          label="Approved members"
          value={totals.converted}
          sub={totals.converted > 0 ? `${pct(rates.endToEnd)} end-to-end conversion` : 'None yet'}
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
