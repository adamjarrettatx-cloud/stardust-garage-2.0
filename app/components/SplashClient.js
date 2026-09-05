'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSound } from './SoundProvider';

export default function SplashClient({ logoUrl }) {
  const { soundOn, toggleSound } = useSound();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-12 md:pt-20 pb-16">
      {/*
        The background audio element itself lives in <SoundProvider> at the
        root of the app so it survives navigation from splash → /home without
        restarting. This page only renders the visible toggle.
      */}

      <div className="flex flex-col items-center -mt-12 md:-mt-20">
        <div className="flex flex-col items-center mb-8 md:mb-10">
          <img
            src="/logos/wordmark-white.svg"
            alt="Stardust Garage"
            style={{ width: 'clamp(250px, 65.78947368421053vw, 440px)', height: 'auto', display: 'block' }}
          />
        </div>

        <Link
          href="/home"
          aria-label="Enter Stardust Garage"
          className="block mb-7 md:mb-8 transition-transform hover:scale-105"
          style={{
            animation: mounted ? 'float-logo 4s ease-in-out infinite' : 'none',
            background: 'transparent',
            backgroundColor: 'transparent',
            WebkitBackfaceVisibility: 'hidden',
            backfaceVisibility: 'hidden',
            WebkitTransform: 'translate3d(0, 0, 0)',
            transform: 'translate3d(0, 0, 0)',
            WebkitTapHighlightColor: 'transparent',
            isolation: 'isolate',
          }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Stardust Garage"
              className="w-[120px] md:w-[150px] h-auto block"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(255,255,255,0.15))',
                background: 'transparent',
                WebkitBackfaceVisibility: 'hidden',
                backfaceVisibility: 'hidden',
              }}
            />
          ) : (
            <div className="w-[120px] md:w-[150px] h-[150px] md:h-[190px] rounded-[14px] flex items-center justify-center text-center px-4" style={{ background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.2)' }}>
              <span className="text-[10px] tracking-[0.2em] text-white/40">UPLOAD SPLASH LOGO IN ADMIN</span>
            </div>
          )}
        </Link>

        <Link href="/home" className="text-[16px] md:text-[18px] italic text-white/85 hover:text-white transition-colors tracking-wide" style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 400 }}>
          enter the portal
        </Link>
      </div>

      <button
        onClick={toggleSound}
        className="absolute bottom-6 left-6 md:bottom-8 md:left-8 flex items-center gap-2.5 text-[12px] tracking-[0.16em] text-white/60 hover:text-white transition-colors"
        style={{ fontFamily: "'Inter', sans-serif" }}
        aria-label={soundOn ? 'Mute sound' : 'Play sound'}
      >
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: soundOn ? '#f5f5f5' : 'rgba(255,255,255,0.3)', boxShadow: soundOn ? '0 0 10px rgba(255,255,255,0.6)' : 'none', transition: 'all 0.2s ease' }} />
        {soundOn ? 'SOUND ON' : 'SOUND OFF'}
      </button>

      <style jsx>{`
        @keyframes float-logo {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(0, -12px, 0); }
        }
      `}</style>
    </main>
  );
}
