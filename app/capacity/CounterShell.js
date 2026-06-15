'use client';

// Shared full-screen presentational shell for the door pages. Renders the big
// count, labeled max capacity, status banner, connection indicator, last-action
// line, and a single huge action button. Designed for the tiny Jelly2 screen:
// one giant tap target, high contrast, no small controls.

const STATUS_BG = {
  none:  '#141414',
  empty: '#0a0a0a',
  open:  '#0a0a0a',
  near:  '#2a1f05',
  full:  '#2a0a0a',
};

const STATUS_LABEL = {
  none:  'No active session',
  empty: 'Empty',
  open:  'Open',
  near:  'Near capacity',
  full:  'AT CAPACITY',
};

const STATUS_COLOR = {
  none:  '#8a8a8a',
  empty: '#8a8a8a',
  open:  '#7CFC9B',
  near:  '#ffb84d',
  full:  '#ff5c5c',
};

export default function CounterShell({
  title,
  accent,            // 'green' | 'red'
  status,            // derived status object
  connected,
  loading,
  error,
  lastAction,
  buttonLabel,
  buttonDisabled,
  onAction,
}) {
  const s = status?.status || 'none';
  const accentColor = accent === 'green' ? '#16a34a' : '#dc2626';
  const accentColorActive = accent === 'green' ? '#15803d' : '#b91c1c';

  return (
    <main
      className="fixed inset-0 flex flex-col select-none"
      style={{ background: STATUS_BG[s] || '#0a0a0a', color: '#f5f5f5', touchAction: 'manipulation' }}
    >
      {/* Header: station name + connection dot */}
      <div className="flex items-center justify-between px-5 pt-5">
        <div className="text-[13px] font-bold tracking-[0.18em] uppercase" style={{ color: '#8a8a8a' }}>
          {title}
        </div>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: connected ? '#7CFC9B' : '#8a8a8a' }}>
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: connected ? '#7CFC9B' : '#555' }}
            aria-hidden
          />
          {connected ? 'Live' : 'Syncing'}
        </div>
      </div>

      {/* Count block */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        {s === 'none' ? (
          <div className="text-center">
            <div className="text-[22px] font-bold mb-2">No active session</div>
            <div className="text-[14px]" style={{ color: '#8a8a8a' }}>
              An admin needs to start a session.
            </div>
          </div>
        ) : (
          <>
            <div
              className="font-extrabold leading-none tabular-nums"
              style={{
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontSize: 'clamp(96px, 38vw, 260px)',
                color: STATUS_COLOR[s] || '#f5f5f5',
              }}
              aria-live="polite"
            >
              {status.count}
            </div>
            <div className="text-[16px] mt-1 font-semibold tracking-wide" style={{ color: '#8a8a8a' }}>
              of {status.max} max
            </div>
            <div
              className="mt-3 px-4 py-1.5 rounded-full text-[13px] font-bold tracking-[0.1em] uppercase"
              style={{ background: 'rgba(255,255,255,0.06)', color: STATUS_COLOR[s] }}
            >
              {STATUS_LABEL[s]}
            </div>
          </>
        )}
      </div>

      {/* Status / error line */}
      <div className="px-5 min-h-[24px] text-center text-[13px]" style={{ color: error ? '#ff8a8a' : '#8a8a8a' }}>
        {error || lastAction || (loading ? 'Loading…' : ' ')}
      </div>

      {/* Giant action button */}
      <div className="px-4 pb-6 pt-2">
        <button
          type="button"
          onClick={onAction}
          disabled={buttonDisabled}
          className="w-full rounded-3xl font-extrabold active:scale-[0.98] transition-transform"
          style={{
            height: 'min(34vh, 220px)',
            fontSize: 'clamp(28px, 9vw, 56px)',
            background: buttonDisabled ? '#3a3a3a' : accentColor,
            color: buttonDisabled ? '#777' : '#fff',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            boxShadow: buttonDisabled ? 'none' : `0 8px 0 ${accentColorActive}`,
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </main>
  );
}
