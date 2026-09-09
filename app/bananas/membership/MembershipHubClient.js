'use client';

// Membership Journey hub client.
//
// Layout, top to bottom:
//
//   1. Header + range selector (7d, 30d, 90d, ytd, all)
//   2. Summary KPI strip — the four numbers Adam checks first
//   3. "Do this today" — top 6 personal actions ranked by urgency
//   4. The Journey funnel — six stages with counts + drop-off between each
//   5. The Journey kanban — six columns with the actual people at each stage
//   6. Signal panels — trial source mix, activation timing, plan mix, denials
//   7. Timeseries — daily new passes + applications + members over the range
//
// Every stage card is intentionally uniform: photo · name · one context line ·
// a "next action" cue. The kind (trial vs application vs member) is signalled
// with a coloured left border, not a whole different card design, so scanning
// across columns stays fast.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuthenticatedTheme } from '@/app/components/AuthenticatedThemeProvider';
import { ANALYTICS_THEMES, FINANCIAL_THEMES } from '@/lib/admin-theme';
import { centsToUsd } from '@/lib/event-analytics';

const THEMES = {
  dark: { ...ANALYTICS_THEMES.dark, ...FINANCIAL_THEMES.dark },
  light: { ...ANALYTICS_THEMES.light, ...FINANCIAL_THEMES.light },
};

const RANGES = [
  { id: '7d',  label: '7 days'  },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'ytd', label: 'YTD'     },
  { id: 'all', label: 'All'     },
];

// The six lifecycle stages, in journey order. `accent` uses the venue palette
// (gold for trial, purple for consideration, green for the finish line, red
// for attention) — no teal/blue, per brand.
const STAGES = [
  { id: 'ready',     label: 'Trial pass ready',    hint: 'Issued, waiting for first visit',    accent: '#ffb84d' },
  { id: 'visited',   label: 'Visited on trial',    hint: 'Came through the door at least once', accent: '#facc15' },
  { id: 'applied',   label: 'Applied for membership', hint: 'Submitted, waiting on your review', accent: '#c084fc' },
  { id: 'approved',  label: 'Approved, awaiting signup', hint: 'You approved, they have not paid yet', accent: '#a78bfa' },
  { id: 'active',    label: 'Active paying member', hint: 'Subscription healthy — the finish line', accent: '#4ade80' },
  { id: 'attention', label: 'Needs attention',     hint: 'Past due, cancelling, or trial expired', accent: '#f87171' },
];

// -----------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtCents(cents) {
  if (cents === null || cents === undefined) return '—';
  return centsToUsd(cents);
}
function fmtRate(x) {
  if (!x || !isFinite(x)) return '0%';
  return `${Math.round(x * 100)}%`;
}
function fmtNumber(x) {
  if (x === null || x === undefined) return '—';
  return Number(x).toLocaleString('en-US');
}
function agoDays(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// -----------------------------------------------------------------------
// Small reusable primitives
// -----------------------------------------------------------------------

function Card({ theme, children, style, className = '' }) {
  return (
    <section
      className={`rounded-[14px] border p-5 ${className}`}
      style={{ background: theme.cardBg, borderColor: theme.cardBorder, ...style }}
    >
      {children}
    </section>
  );
}

function SectionTitle({ theme, children, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ color: theme.mutedStrong }}>
        {children}
      </h2>
      {right}
    </div>
  );
}

function Kpi({ label, value, hint, theme, accent }) {
  return (
    <div
      className="rounded-[12px] border p-4"
      style={{ background: theme.cardBg, borderColor: theme.cardBorder }}
    >
      <div className="text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ color: theme.mutedStrong }}>
        {label}
      </div>
      <div className="text-[28px] font-semibold mt-1" style={{ color: accent || theme.text, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.01em' }}>
        {value}
      </div>
      {hint ? (
        <div className="text-[11px] mt-1" style={{ color: theme.muted }}>{hint}</div>
      ) : null}
    </div>
  );
}

function Avatar({ name, photoUrl, theme, size = 36, accent }) {
  const initials = (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full overflow-hidden shrink-0"
      style={{
        width: size, height: size,
        background: theme.neutralChipBg,
        border: `1px solid ${accent || theme.cardBorder}`,
        color: theme.mutedStrong,
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : initials}
    </div>
  );
}

// -----------------------------------------------------------------------
// The Funnel — six horizontal stacked bars, narrowing left to right.
// Each stage bar's width is proportional to its count relative to the top
// stage, so the drop-off between "visited" and "applied" (etc.) reads as
// a visual gap, not just a number.
// -----------------------------------------------------------------------

function FunnelChart({ funnel, theme }) {
  const steps = funnel?.steps || [];
  const top = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const width = Math.max(4, Math.round((s.count / top) * 100));
        const stage = STAGES.find((x) => x.id === s.key);
        const rate = i === 0 ? 1 : (s.rate_of_prev || 0);
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className="w-[220px] text-[12px]" style={{ color: theme.mutedStrong }}>
              {s.label}
            </div>
            <div className="flex-1 h-9 rounded-md overflow-hidden relative"
              style={{ background: theme.neutralChipBg, border: `1px solid ${theme.tableBorder}` }}>
              <div
                className="h-full rounded-md transition-all"
                style={{ width: `${width}%`, background: stage?.accent || theme.mutedStrong }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-3">
                <span className="text-[12px] font-semibold" style={{ color: theme.text, mixBlendMode: 'difference' }}>
                  {fmtNumber(s.count)}
                </span>
                {i > 0 ? (
                  <span className="text-[11px] font-mono" style={{ color: theme.text, mixBlendMode: 'difference' }}>
                    {fmtRate(rate)} of previous
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
      <div className="text-[11px] mt-1" style={{ color: theme.muted }}>
        End-to-end conversion: <span style={{ color: theme.text, fontWeight: 600 }}>{fmtRate(funnel?.end_to_end)}</span> of trial passes issued become paying members.
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Journey Kanban — one column per stage, each column shows the actual
// people currently at that stage. Clicking a card jumps to that person's
// detail page (application or member). Trial-pass rows are unclickable
// because trial passes don't have their own admin detail yet, but they
// still show the countdown so Adam knows who to nudge personally.
// -----------------------------------------------------------------------

function StageColumn({ stage, rows, theme }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 5);

  return (
    <div
      className="rounded-[12px] border flex flex-col"
      style={{ background: theme.cardBg, borderColor: theme.cardBorder, minHeight: 260 }}
    >
      <div
        className="px-4 py-3 border-b flex items-center justify-between"
        style={{ borderColor: theme.cardBorder, borderTopLeftRadius: 12, borderTopRightRadius: 12, background: stage.accent + '18' }}
      >
        <div>
          <div className="text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ color: stage.accent }}>
            {stage.label}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: theme.muted }}>{stage.hint}</div>
        </div>
        <div className="text-[22px] font-semibold" style={{ color: theme.text, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
          {fmtNumber(rows.length)}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6 text-[12px]" style={{ color: theme.muted }}>
          Nobody here right now.
        </div>
      ) : (
        <div className="flex-1 flex flex-col divide-y" style={{ borderColor: theme.rowBorder }}>
          {visible.map((row) => (
            <StageRow key={`${row.kind}-${row.id}`} row={row} stage={stage} theme={theme} />
          ))}
        </div>
      )}

      {rows.length > 5 ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="border-t px-4 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase"
          style={{ color: theme.mutedStrong, borderColor: theme.cardBorder, background: 'transparent' }}
        >
          {expanded ? 'Show less' : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

// A single person card inside a stage column. Uniform shape across all six
// stages: [avatar] name · one context line · optional badge.
function StageRow({ row, stage, theme }) {
  const inner = (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-[color:var(--auth-hover-bg)] transition-colors"
      style={{ borderLeft: `3px solid ${stage.accent}` }}>
      <Avatar name={row.full_name} photoUrl={row.photo_url} theme={theme} accent={stage.accent} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate" style={{ color: theme.text }}>
          {row.full_name || row.email || 'Unnamed'}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: theme.muted }}>
          <StageContext row={row} />
        </div>
      </div>
      <StageBadge row={row} theme={theme} />
    </div>
  );
  return row.href ? <Link href={row.href} className="block">{inner}</Link> : inner;
}

// The "one context line" — chosen for each kind so the row is legible at a
// glance without a header row for every field.
function StageContext({ row }) {
  if (row.kind === 'trial') {
    if (row.visits > 0) return <>Visited {row.visits}× · last {fmtWhen(row.last_visit)}</>;
    if (row.activated_at) return <>Activated {fmtDate(row.activated_at)} · {row.days_left}d left</>;
    return <>Issued {fmtDate(row.issued_at)} · {row.days_left != null ? `${row.days_left}d to activate` : ''}</>;
  }
  if (row.kind === 'application') {
    const days = agoDays(row.applied_at || row.created_at);
    return <>{row.plan_display || 'Plan?'} · waiting {days}d · {row.status}</>;
  }
  if (row.kind === 'member') {
    if (row.stripe_bucket === 'attention') {
      if (row.cancel_at_period_end) return <>{row.subscription_plan_display} · cancels {fmtDate(row.current_period_end)}</>;
      return <>{row.subscription_plan_display} · {row.subscription_status}</>;
    }
    return <>{row.subscription_plan_display} · {fmtCents(row.monthly_cents)}/mo · since {fmtDate(row.member_since)}</>;
  }
  return null;
}

function StageBadge({ row, theme }) {
  if (row.kind === 'trial') {
    if (typeof row.days_left === 'number' && row.days_left <= 5) {
      return <Pill text={`${row.days_left}d`} bg="#f8717120" border="#f87171" color="#f87171" />;
    }
    return null;
  }
  if (row.kind === 'application') {
    const days = agoDays(row.applied_at || row.created_at);
    if (days >= 3) return <Pill text={`${days}d`} bg="#facc1520" border="#facc15" color="#facc15" />;
    return null;
  }
  if (row.kind === 'member') {
    if (row.subscription_status === 'past_due') return <Pill text="PAST DUE" bg="#f8717120" border="#f87171" color="#f87171" />;
    if (row.cancel_at_period_end) return <Pill text="CANCELLING" bg="#facc1520" border="#facc15" color="#facc15" />;
    return null;
  }
  return null;
}

function Pill({ text, bg, border, color }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full shrink-0"
      style={{ background: bg, border: `1px solid ${border}`, color, letterSpacing: '0.06em' }}>
      {text}
    </span>
  );
}

// -----------------------------------------------------------------------
// Do This Today — flat checklist of Adam's highest-urgency actions.
// -----------------------------------------------------------------------
function NextActions({ actions, theme }) {
  if (!actions?.length) {
    return (
      <div className="text-[12px]" style={{ color: theme.muted }}>
        Inbox zero. Nothing on fire — go build something.
      </div>
    );
  }
  return (
    <div className="flex flex-col divide-y" style={{ borderColor: theme.rowBorder }}>
      {actions.map((a, i) => (
        <Link key={i} href={a.href || '#'} className="flex items-start gap-3 py-3 hover:opacity-90 transition-opacity">
          <div
            className="shrink-0 rounded-full mt-[6px]"
            style={{ width: 8, height: 8, background: a.kind === 'member_attention' ? '#f87171' : a.kind === 'trial_expired' ? '#facc15' : '#c084fc' }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate" style={{ color: theme.text }}>{a.title}</div>
            <div className="text-[11px]" style={{ color: theme.muted }}>{a.subtitle}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// Timeseries — hand-rolled SVG, matching /bananas/sales.
// Three overlapping bar series (passes, applications, members) per day.
// -----------------------------------------------------------------------
function TimeseriesChart({ data, theme }) {
  if (!data?.length) return null;
  const width = 900;
  const height = 180;
  const pad = { top: 12, right: 12, bottom: 22, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => Math.max(d.passes, d.applications, d.members)));
  const step = innerW / data.length;
  const barW = Math.max(1, step * 0.28);

  const yTick = (v) => pad.top + innerH - (v / max) * innerH;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {/* y-axis grid */}
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={pad.left} x2={width - pad.right} y1={yTick(max * f)} y2={yTick(max * f)}
          stroke={theme.tableBorder} strokeDasharray="2 4" />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={`t${f}`} x={pad.left - 4} y={yTick(max * f) + 3} textAnchor="end"
          fontSize="9" fill={theme.muted}>{Math.round(max * f)}</text>
      ))}
      {data.map((d, i) => {
        const x = pad.left + i * step + step / 2;
        return (
          <g key={d.day}>
            <rect x={x - barW * 1.5} y={yTick(d.passes)} width={barW}
              height={pad.top + innerH - yTick(d.passes)} fill="#ffb84d" opacity="0.9" />
            <rect x={x - barW * 0.5} y={yTick(d.applications)} width={barW}
              height={pad.top + innerH - yTick(d.applications)} fill="#c084fc" opacity="0.9" />
            <rect x={x + barW * 0.5} y={yTick(d.members)} width={barW}
              height={pad.top + innerH - yTick(d.members)} fill="#4ade80" opacity="0.9" />
          </g>
        );
      })}
      {/* first, mid, last x labels */}
      {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
        <text key={`x${i}`} x={pad.left + i * step + step / 2} y={height - 6}
          textAnchor="middle" fontSize="9" fill={theme.muted}>
          {fmtDate(data[i]?.day)}
        </text>
      ))}
    </svg>
  );
}

// -----------------------------------------------------------------------
// The hub
// -----------------------------------------------------------------------
export default function MembershipHubClient({ initialRange = '30d' }) {
  const { theme: mode } = useAuthenticatedTheme();
  const theme = THEMES[mode] || THEMES.dark;

  const [range, setRange] = useState(initialRange);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/membership/journey?range=${range}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => { if (!cancelled) setPayload(json); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  const summary = payload?.summary;
  const stagesData = payload?.stages || {};
  const funnel = payload?.funnel;
  const nextActions = payload?.next_actions || [];
  const trial = payload?.trial || {};
  const memberStats = payload?.members || {};
  const timeseries = payload?.timeseries || [];

  const planMixRows = useMemo(() => {
    return Object.entries(memberStats.plan_mix || {}).sort((a, b) => b[1] - a[1]);
  }, [memberStats.plan_mix]);
  const sourceMixRows = useMemo(() => {
    return Object.entries(trial.source_mix || {}).sort((a, b) => b[1] - a[1]);
  }, [trial.source_mix]);

  return (
    <div className="space-y-6" style={{ color: theme.text }}>
      <div className="max-w-[1400px] mx-auto">

        {/* ------------ Header ------------ */}
        <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-1" style={{ color: theme.muted }}>
              Bananas · Membership
            </div>
            <h1 className="text-[32px] font-semibold leading-none" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", letterSpacing: '-0.02em' }}>
              The Journey
            </h1>
            <p className="text-[13px] mt-2 max-w-[640px]" style={{ color: theme.muted }}>
              Everyone in the funnel — QR scan to paying member — on one page. Every card is a person. Every column is where they&apos;re stuck.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex rounded-full border overflow-hidden"
              style={{ borderColor: theme.cardBorder, background: theme.cardBg }}>
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className="px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors"
                  style={{
                    color: r.id === range ? theme.text : theme.muted,
                    background: r.id === range ? theme.neutralChipBg : 'transparent',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Link href="/team/trial-pass/manual"
              className="text-[11px] font-semibold tracking-[0.12em] uppercase px-3 py-1.5 rounded-full border"
              style={{ borderColor: theme.cardBorder, color: theme.text }}>
              Issue Trial Pass
            </Link>
          </div>
        </header>

        {error ? (
          <Card theme={theme}>
            <div className="text-[13px]" style={{ color: '#f87171' }}>Failed to load: {error}</div>
          </Card>
        ) : null}

        {/* ------------ KPI strip ------------ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Kpi theme={theme} label="Trial passes issued" value={fmtNumber(summary?.total_trial_passes)} hint="Lifetime, all sources" />
          <Kpi theme={theme} label="Active paying members" value={fmtNumber(summary?.active_members)} accent="#4ade80" hint="Healthy subscriptions right now" />
          <Kpi theme={theme} label="Monthly recurring" value={fmtCents(summary?.mrr_cents)} accent="#facc15" hint="MRR from healthy subs, in USD" />
          <Kpi theme={theme} label="Needs your attention" value={fmtNumber(summary?.attention_count)} accent="#f87171" hint="Past-due, cancelling or expired" />
        </div>

        {/* ------------ Do this today + Funnel ------------ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <Card theme={theme} className="lg:col-span-1">
            <SectionTitle theme={theme}>Do this today</SectionTitle>
            <NextActions actions={nextActions} theme={theme} />
          </Card>
          <Card theme={theme} className="lg:col-span-2">
            <SectionTitle theme={theme}>The funnel</SectionTitle>
            {funnel ? <FunnelChart funnel={funnel} theme={theme} /> : <div style={{ color: theme.muted }}>—</div>}
          </Card>
        </div>

        {/* ------------ The Kanban ------------ */}
        <SectionTitle theme={theme}>
          The journey
          <span className="normal-case tracking-normal text-[11px] ml-2" style={{ color: theme.muted, fontWeight: 400 }}>
            everyone currently in the pipeline
          </span>
        </SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {STAGES.map((stage) => (
            <StageColumn key={stage.id} stage={stage} rows={stagesData[stage.id] || []} theme={theme} />
          ))}
        </div>

        {/* ------------ Signal panels ------------ */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <Card theme={theme}>
            <SectionTitle theme={theme}>Trial sources</SectionTitle>
            {sourceMixRows.length ? sourceMixRows.map(([src, n]) => (
              <div key={src} className="flex items-center justify-between py-1.5 border-b last:border-b-0"
                style={{ borderColor: theme.rowBorder }}>
                <span className="text-[13px] capitalize" style={{ color: theme.text }}>{src.replace(/_/g, ' ')}</span>
                <span className="text-[13px] font-mono" style={{ color: theme.mutedStrong }}>{fmtNumber(n)}</span>
              </div>
            )) : <div className="text-[12px]" style={{ color: theme.muted }}>No sources yet.</div>}
          </Card>

          <Card theme={theme}>
            <SectionTitle theme={theme}>How fast they visit</SectionTitle>
            {Object.entries(trial.activation_days || {}).map(([bucket, n]) => {
              const total = Object.values(trial.activation_days || {}).reduce((a, b) => a + b, 0) || 1;
              const pct = Math.round((n / total) * 100);
              return (
                <div key={bucket} className="mb-2 last:mb-0">
                  <div className="flex justify-between text-[12px]" style={{ color: theme.mutedStrong }}>
                    <span>{bucket === 'same' ? 'Same day' : `${bucket} days`}</span>
                    <span className="font-mono">{fmtNumber(n)} · {pct}%</span>
                  </div>
                  <div className="h-1.5 mt-1 rounded" style={{ background: theme.neutralChipBg }}>
                    <div className="h-full rounded" style={{ width: `${pct}%`, background: '#ffb84d' }} />
                  </div>
                </div>
              );
            })}
          </Card>

          <Card theme={theme}>
            <SectionTitle theme={theme}>Plan mix</SectionTitle>
            {planMixRows.length ? planMixRows.map(([plan, n]) => (
              <div key={plan} className="flex items-center justify-between py-1.5 border-b last:border-b-0"
                style={{ borderColor: theme.rowBorder }}>
                <span className="text-[13px]" style={{ color: theme.text }}>{plan}</span>
                <span className="text-[13px] font-mono" style={{ color: theme.mutedStrong }}>{fmtNumber(n)}</span>
              </div>
            )) : <div className="text-[12px]" style={{ color: theme.muted }}>No paying members yet.</div>}
          </Card>

          <Card theme={theme}>
            <SectionTitle theme={theme}>Door denials</SectionTitle>
            <div className="text-[24px] font-semibold mb-2" style={{ color: '#f87171', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
              {fmtNumber(trial.denied_total || 0)}
            </div>
            {(trial.denied_reasons || []).slice(0, 4).map((r) => (
              <div key={r.reason} className="flex items-center justify-between py-1 text-[12px]" style={{ color: theme.mutedStrong }}>
                <span className="truncate">{r.reason}</span>
                <span className="font-mono ml-2">{fmtNumber(r.count)}</span>
              </div>
            ))}
            {(!trial.denied_reasons || !trial.denied_reasons.length) ? (
              <div className="text-[12px]" style={{ color: theme.muted }}>No denials on record — clean sheet.</div>
            ) : null}
          </Card>
        </div>

        {/* ------------ Timeseries ------------ */}
        <Card theme={theme}>
          <SectionTitle theme={theme} right={
            <div className="flex items-center gap-3 text-[11px]" style={{ color: theme.muted }}>
              <LegendDot color="#ffb84d" label="Trial passes" />
              <LegendDot color="#c084fc" label="Applications" />
              <LegendDot color="#4ade80" label="New members" />
            </div>
          }>
            Daily inflow
          </SectionTitle>
          <TimeseriesChart data={timeseries} theme={theme} />
        </Card>

        {loading && !payload ? (
          <div className="text-center text-[12px] mt-6" style={{ color: theme.muted }}>Loading the journey…</div>
        ) : null}
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}
