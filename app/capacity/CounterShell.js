'use client';

// Shared full-screen presentational shell for the two Jelly2 door pages.
// Renders the big count, labeled max capacity, status banner, connection
// indicator, a single-line last-action note, and one huge action button.
//
// Tuned for the Unihertz Jelly2 kiosk: a 3.0" 480x854 screen that reports a
// very narrow AND very short CSS viewport. The layout is a height-aware flex
// column locked to the dynamic viewport (100dvh) with safe-area padding, so it
// never scrolls or overflows. The count scales on `vmin` (not `vw`) so it
// shrinks with the short height as well as the narrow width.

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
      className="kiosk-shell fixed inset-0 flex flex-col select-none overflow-hidden"
      style={{ background: STATUS_BG[s] || '#0a0a0a', color: '#f5f5f5', touchAction: 'manipulation' }}
    >
      {/* Header: station name + connection dot */}
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="kiosk-title font-bold tracking-[0.16em] uppercase truncate" style={{ color: '#8a8a8a' }}>
          {title}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 kiosk-conn" style={{ color: connected ? '#7CFC9B' : '#8a8a8a' }}>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: connected ? '#7CFC9B' : '#555' }}
            aria-hidden
          />
          {connected ? 'Live' : 'Syncing'}
        </div>
      </div>

      {/* Count block — flex-1 + min-h-0 lets it shrink instead of pushing the
          button off a short screen. */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-3 overflow-hidden">
        {s === 'none' ? (
          <div className="text-center px-2">
            <div className="kiosk-nosession font-bold mb-1">No active session</div>
            <div className="kiosk-note" style={{ color: '#8a8a8a' }}>
              An admin needs to start a session.
            </div>
          </div>
        ) : (
          <>
            <div
              className="kiosk-count font-extrabold leading-none tabular-nums"
              style={{
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                color: STATUS_COLOR[s] || '#f5f5f5',
              }}
              aria-live="polite"
            >
              {status.count}
            </div>
            <div className="kiosk-max mt-0.5 font-semibold tracking-wide" style={{ color: '#8a8a8a' }}>
              of {status.max} max
            </div>
            <div
              className="kiosk-pill mt-2 rounded-full font-bold tracking-[0.1em] uppercase truncate max-w-full"
              style={{ background: 'rgba(255,255,255,0.06)', color: STATUS_COLOR[s] }}
            >
              {STATUS_LABEL[s]}
            </div>
          </>
        )}
      </div>

      {/* Status / error line — single line, truncates so a long note never
          wraps or forces the layout taller on the tiny screen. */}
      <div
        className="kiosk-status px-3 text-center truncate"
        style={{ color: error ? '#ff8a8a' : '#8a8a8a' }}
      >
        {error || lastAction || (loading ? 'Loading…' : ' ')}
      </div>

      {/* Giant action button */}
      <div className="px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onAction}
          disabled={buttonDisabled}
          className="kiosk-button w-full rounded-3xl font-extrabold active:scale-[0.98] transition-transform"
          style={{
            background: buttonDisabled ? '#3a3a3a' : accentColor,
            color: buttonDisabled ? '#777' : '#fff',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            boxShadow: buttonDisabled ? 'none' : `0 6px 0 ${accentColorActive}`,
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </main>
  );
}
