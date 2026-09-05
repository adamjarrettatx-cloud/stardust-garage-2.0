'use client';

import { usePathname } from 'next/navigation';
import { useSound } from './SoundProvider';

/**
 * Tiny always-on sound toggle rendered on every page EXCEPT:
 *   - `/`            → the splash page has its own larger SOUND ON/OFF control.
 *   - `/capacity/*`  → full-screen door stations; kept chrome-free like Navbar.
 *
 * Fixed to the bottom-left corner, matching the splash-page toggle's
 * position, so users always know where the mute is.
 */
export default function GlobalSoundToggle() {
  const pathname = usePathname();
  const { soundOn, toggleSound, ready } = useSound();

  if (!ready) return null;
  if (pathname === '/' || (pathname && pathname.startsWith('/capacity'))) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={toggleSound}
      aria-label={soundOn ? 'Mute sound' : 'Play sound'}
      title={soundOn ? 'Mute sound' : 'Play sound'}
      className="fixed bottom-3 left-3 md:bottom-4 md:left-4 z-50 flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[10px] tracking-[0.16em] text-white/55 hover:text-white transition-colors"
      style={{
        fontFamily: "'Inter', sans-serif",
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{
          background: soundOn ? '#f5f5f5' : 'rgba(255,255,255,0.3)',
          boxShadow: soundOn ? '0 0 8px rgba(255,255,255,0.55)' : 'none',
          transition: 'all 0.2s ease',
        }}
      />
      {soundOn ? 'SOUND ON' : 'SOUND OFF'}
    </button>
  );
}
