'use client';

import { useRouter } from 'next/navigation';

/**
 * A homepage portal tile that morphs into a destination page using the
 * View Transitions API. The tile's `view-transition-name` matches the
 * destination page's hero element so the browser interpolates between them.
 *
 * Falls back gracefully on browsers without View Transitions support
 * (Safari < 18.2, older Firefox) — the navigation just happens instantly.
 */
export default function PortalTile({
  href,
  transitionName,
  eyebrow,
  title,
  summary,
  bullets = [],
  meta,
  cta,
  bgImage,
  // Tailwind-friendly tint applied over the background image (or as the
  // background itself when bgImage is empty). Use a subtle radial gradient
  // tied to the brand for now; replace with real media later.
  tint = 'radial-gradient(ellipse at center, rgba(40,40,55,0.85) 0%, rgba(10,10,16,0.95) 100%)',
}) {
  const router = useRouter();

  const handleClick = (e) => {
    e.preventDefault();

    // Progressive enhancement: only run the transition if the API exists.
    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => {
        router.push(href);
      });
    } else {
      router.push(href);
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className="group relative block overflow-hidden rounded-[20px] border transition-all duration-500 ease-out hover:-translate-y-1 hover:border-white/20"
      style={{
        borderColor: 'rgba(255,255,255,0.08)',
        aspectRatio: '4 / 5',
        viewTransitionName: transitionName,
        // Stack: bg image -> dark tint -> content
        backgroundImage: bgImage ? `${tint}, url(${bgImage})` : tint,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Subtle vignette + corner glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.08) 0%, transparent 50%)',
        }}
      />

      {/* Subtle scanline texture — matches EventsTile surface treatment */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-[0.08]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 3px)',
        }}
      />

      {/* Content */}
      <div className="relative h-full flex flex-col justify-between p-8 md:p-10">
        <div>
          <div
            className="text-[10px] font-semibold tracking-[0.28em] mb-4 transition-opacity duration-500"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            {eyebrow}
          </div>
          <h2
            className="text-white leading-[0.9] -tracking-[0.01em]"
            style={{
              fontFamily: "'Moshra Aesthetic', 'Cormorant Unicase', serif",
              fontWeight: 400,
              fontSize: 'clamp(48px, 7vw, 84px)',
            }}
          >
            {title}
          </h2>
        </div>

        <div className="space-y-5">
          {summary && (
            <p
              className="text-[14px] md:text-[15px] leading-[1.55] max-w-[34ch]"
              style={{ color: 'rgba(255,255,255,0.78)' }}
            >
              {summary}
            </p>
          )}

          {bullets.length > 0 && (
            <ul className="flex flex-col">
              {bullets.map((b, i) => (
                <li
                  key={b}
                  className="py-2.5 text-[13px] leading-[1.45]"
                  style={{
                    borderTop: i === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.78)',
                  }}
                >
                  {b}
                </li>
              ))}
            </ul>
          )}

          {meta && (
            <div
              className="text-[10.5px] font-semibold tracking-[0.22em] uppercase pt-1"
              style={{ color: 'rgba(255,255,255,0.45)' }}
            >
              {meta}
            </div>
          )}

          <div
            className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] pt-2 transition-all duration-300 group-hover:gap-3"
            style={{ color: '#ffffff' }}
          >
            {cta || 'ENTER'}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </div>
        </div>
      </div>
    </a>
  );
}
