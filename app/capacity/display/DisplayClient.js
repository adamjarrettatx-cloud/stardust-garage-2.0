'use client';

import { useCapacity } from '../useCapacity';

const STATUS = {
  none:  { label: 'No active session', color: '#8a8a8a' },
  empty: { label: 'Empty',            color: '#8a8a8a' },
  open:  { label: 'Open',             color: '#7CFC9B' },
  near:  { label: 'Near capacity',    color: '#ffb84d' },
  full:  { label: 'At capacity',      color: '#ff5c5c' },
};

// Read-only big-screen view for the Raspberry Pi monitor/TV. No buttons; just a
// large live count, max capacity, status, and a fill bar. Stays in sync via the
// same realtime/poll hook as the door pages.
export default function DisplayClient() {
  const { status, connected, session } = useCapacity({ pollMs: 5000 });
  const s = status.status || 'none';
  const meta = STATUS[s] || STATUS.none;
  const pct = status.max > 0 ? Math.min(100, Math.round((status.count / status.max) * 100)) : 0;

  return (
    <main
      className="fixed inset-0 flex flex-col items-center justify-center select-none px-6"
      style={{ background: '#0a0a0a', color: '#f5f5f5' }}
    >
      <div className="absolute top-5 left-6 text-[14px] font-bold tracking-[0.2em] uppercase" style={{ color: '#8a8a8a' }}>
        {session?.name || 'Stardust Garage'} · Capacity
      </div>
      <div className="absolute top-5 right-6 flex items-center gap-2 text-[12px]" style={{ color: connected ? '#7CFC9B' : '#8a8a8a' }}>
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: connected ? '#7CFC9B' : '#555' }} aria-hidden />
        {connected ? 'Live' : 'Syncing'}
      </div>

      {s === 'none' ? (
        <div className="text-[32px] font-bold" style={{ color: '#8a8a8a' }}>No active session</div>
      ) : (
        <>
          <div
            className="font-extrabold leading-none tabular-nums"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 'clamp(140px, 30vw, 420px)', color: meta.color }}
            aria-live="polite"
          >
            {status.count}
          </div>
          <div className="text-[clamp(20px,4vw,40px)] font-semibold" style={{ color: '#8a8a8a' }}>
            of {status.max} max
          </div>
          <div
            className="mt-6 px-6 py-2 rounded-full text-[clamp(16px,2.5vw,28px)] font-bold tracking-[0.12em] uppercase"
            style={{ background: 'rgba(255,255,255,0.06)', color: meta.color }}
          >
            {meta.label}
          </div>

          {/* Fill bar */}
          <div className="mt-10 w-full max-w-[900px] h-6 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: meta.color }}
            />
          </div>
        </>
      )}
    </main>
  );
}
