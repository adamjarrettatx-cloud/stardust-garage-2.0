'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hero showcase for the venue rental page. Three flagship inclusions
 * presented as full-bleed cards with restrained, looping micro-animations
 * on the visual element and a stagger-in reveal on scroll.
 */

const items = [
  {
    eyebrow: 'SOUND',
    title: 'L-Acoustics 4-Point System',
    desc: 'A reference-grade rig in a purpose-built, acoustically treated warehouse \u2014 broadband absorption, bass trapping, no hot spots in the room.',
    spec: 'L-Acoustics \u00b7 tuned to the room',
    visual: 'sound',
  },
  {
    eyebrow: 'LIGHTING',
    title: 'Full Lighting Production',
    desc: 'A complete house lighting rig with pre-programmed scenes. Plug in and go, or run your own show.',
    spec: 'Moving heads \u00b7 washes \u00b7 haze',
    visual: 'lighting',
  },
  {
    eyebrow: 'BOOTH',
    title: 'Plug-and-Play DJ Booth',
    desc: 'Patched in and ready. Bring a USB and start your set.',
    visual: 'booth',
    equipment: [
      { count: 3, label: 'CDJ-3000' },
      { count: 1, label: 'DJM-V10' },
      { count: 2, label: 'Booth Monitors' },
    ],
  },
];

function SoundVisual() {
  return (
    <svg
      viewBox="0 0 200 120"
      className="w-full h-full"
      fill="none"
      stroke="currentColor"
    >
      {/* Speaker box */}
      <rect x="86" y="40" width="28" height="40" rx="2" strokeWidth="1.2" opacity="0.85" />
      <circle cx="100" cy="56" r="5" strokeWidth="1.2" opacity="0.85" />
      <circle cx="100" cy="70" r="3" strokeWidth="1.2" opacity="0.85" />

      {[0, 1, 2].map((i) => (
        <g key={`l-${i}`} className="sound-wave-left" style={{ animationDelay: `${i * 0.8}s` }}>
          <path
            d="M 78 60 Q 60 60 50 50 Q 40 60 50 70 Q 60 60 78 60"
            strokeWidth="1"
            opacity="0.5"
            transform="translate(-10 0)"
          />
        </g>
      ))}
      {[0, 1, 2].map((i) => (
        <g key={`r-${i}`} className="sound-wave-right" style={{ animationDelay: `${i * 0.8}s` }}>
          <path
            d="M 122 60 Q 140 60 150 50 Q 160 60 150 70 Q 140 60 122 60"
            strokeWidth="1"
            opacity="0.5"
            transform="translate(10 0)"
          />
        </g>
      ))}

      <style jsx>{`
        .sound-wave-left {
          transform-origin: 100px 60px;
          animation: pulseLeft 2.4s ease-out infinite;
          opacity: 0;
        }
        .sound-wave-right {
          transform-origin: 100px 60px;
          animation: pulseRight 2.4s ease-out infinite;
          opacity: 0;
        }
        @keyframes pulseLeft {
          0% { transform: translate(0, 0) scale(0.7); opacity: 0; }
          25% { opacity: 0.55; }
          100% { transform: translate(-22px, 0) scale(1.15); opacity: 0; }
        }
        @keyframes pulseRight {
          0% { transform: translate(0, 0) scale(0.7); opacity: 0; }
          25% { opacity: 0.55; }
          100% { transform: translate(22px, 0) scale(1.15); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}

/**
 * Lighting: a single stylized spotlight casting a soft, slowly
 * widening/narrowing beam. Pure light symbol — no fixtures, no levels.
 */
function LightingVisual() {
  return (
    <svg viewBox="0 0 200 120" className="w-full h-full" fill="none">
      <defs>
        <linearGradient id="beam-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="glow-grad" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.6" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Beam */}
      <g className="beam" style={{ transformOrigin: '100px 22px' }}>
        <path d="M 90 22 L 60 110 L 140 110 L 110 22 Z" fill="url(#beam-grad)" />
      </g>

      {/* Light source dot + halo */}
      <circle cx="100" cy="22" r="24" fill="url(#glow-grad)" className="halo" />
      <circle cx="100" cy="22" r="4" fill="currentColor" opacity="0.95" />

      {/* Floor pool */}
      <ellipse cx="100" cy="110" rx="40" ry="5" fill="url(#glow-grad)" className="halo" />

      <style jsx>{`
        .beam {
          animation: beamPulse 4.5s ease-in-out infinite;
        }
        .halo {
          animation: haloPulse 4.5s ease-in-out infinite;
        }
        @keyframes beamPulse {
          0%, 100% { transform: scaleX(0.85); opacity: 0.7; }
          50% { transform: scaleX(1.15); opacity: 1; }
        }
        @keyframes haloPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </svg>
  );
}

/**
 * Booth: a single symbolic mark — concentric circles like a record's
 * grooves seen from above, with a slow rotating tonearm-like line.
 */
function BoothVisual() {
  const cx = 100;
  const cy = 60;
  return (
    <svg viewBox="0 0 200 120" className="w-full h-full" fill="none" stroke="currentColor">
      <circle cx={cx} cy={cy} r="44" strokeWidth="1.2" opacity="0.5" />
      <circle cx={cx} cy={cy} r="34" strokeWidth="1" opacity="0.4" />
      <circle cx={cx} cy={cy} r="24" strokeWidth="0.9" opacity="0.35" />
      <circle cx={cx} cy={cy} r="14" strokeWidth="0.9" opacity="0.5" />
      <circle cx={cx} cy={cy} r="3" fill="currentColor" stroke="none" opacity="0.85" />

      <g
        className="arm"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      >
        <line x1={cx} y1={cy} x2={cx + 44} y2={cy} strokeWidth="1" opacity="0.55" />
      </g>

      <style jsx>{`
        .arm {
          animation: spin 12s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </svg>
  );
}

function visualFor(name) {
  if (name === 'sound') return <SoundVisual />;
  if (name === 'lighting') return <LightingVisual />;
  if (name === 'booth') return <BoothVisual />;
  return null;
}

function ShowcaseCard({ item, index }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <article
      ref={ref}
      className="relative rounded-[20px] border overflow-hidden flex flex-col"
      style={{
        background:
          'linear-gradient(180deg, rgba(20,20,26,0.8) 0%, rgba(12,12,16,0.95) 100%)',
        borderColor: 'rgba(255,255,255,0.07)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(28px)',
        transition: `opacity 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${
          index * 120
        }ms, transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${index * 120}ms`,
      }}
    >
      {/* Visual area */}
      <div
        className="relative h-[180px] flex items-center justify-center px-8 pt-8"
        style={{
          color: 'rgba(245,245,240,0.85)',
          background:
            'radial-gradient(120% 100% at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 70%)',
        }}
      >
        <div className="w-full h-full max-w-[260px]">{visualFor(item.visual)}</div>
        <div
          className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-[0.06]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 3px)',
          }}
        />
      </div>

      {/* Text */}
      <div className="p-7 md:p-8 flex flex-col flex-1">
        <div
          className="text-[10px] font-semibold tracking-[0.28em] mb-3"
          style={{ color: 'rgba(255,255,255,0.45)' }}
        >
          {item.eyebrow}
        </div>
        <h3
          className="text-[20px] md:text-[22px] font-bold -tracking-[0.01em] leading-[1.15] mb-3"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {item.title}
        </h3>
        <p
          className="text-[13.5px] leading-[1.6] mb-5"
          style={{ color: 'rgba(255,255,255,0.62)' }}
        >
          {item.desc}
        </p>
        {item.equipment ? (
          <div className="grid grid-cols-3 gap-2 mt-auto">
            {item.equipment.map((gear) => (
              <div
                key={gear.label}
                className="rounded-[10px] border px-3 py-3 flex flex-col items-center text-center"
                style={{
                  borderColor: 'rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.025)',
                }}
              >
                <span
                  className="text-[22px] font-bold tabular-nums leading-none -tracking-[0.02em] mb-2"
                  style={{
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    color: 'rgba(255,255,255,0.92)',
                  }}
                >
                  {gear.count}
                </span>
                <span
                  className="text-[11.5px] font-semibold leading-[1.2]"
                  style={{
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    color: 'rgba(255,255,255,0.78)',
                  }}
                >
                  {gear.label}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="text-[10.5px] font-semibold tracking-[0.22em] uppercase pt-4 mt-auto border-t"
            style={{
              color: 'rgba(255,255,255,0.5)',
              borderColor: 'rgba(255,255,255,0.07)',
            }}
          >
            {item.spec}
          </div>
        )}
      </div>
    </article>
  );
}

export default function VenueShowcase() {
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {items.map((item, i) => (
        <ShowcaseCard key={item.title} item={item} index={i} />
      ))}
    </section>
  );
}
