// Reusable brand wordmark.
// Use this anywhere the Stardust Garage logo/identity should appear, so the
// brand stays consistent across the site.
//
// Every size renders the official wordmark artwork. The pre-refresh live-text
// rendering ("STARDUST" in Moshra over a letterspaced "GARAGE") is gone; it
// only ever survived below "xl" because the brand refresh was applied to the
// homepage hero and nothing else, which left the navbar and every signed-out
// auth screen still showing the old logo.
const WORDMARK_IMAGE_SRC = '/logos/wordmark-white.svg';

// Widths only — the artwork's native 1006:376 ratio supplies the height. Each
// pair is picked so the mark occupies roughly the height the live text used to
// at that size (mobile / desktop).
//   sm  — navbar
//   md  — admin login, footers, secondary headers
//   lg  — page heroes
//   xl  — homepage hero / splash
const SIZES = {
  sm: { mobile: 92, desktop: 92 },
  md: { mobile: 124, desktop: 150 },
  lg: { mobile: 188, desktop: 254 },
  xl: { mobile: 250, desktop: 440 },
};

export default function Wordmark({ size = 'sm', align = 'start', className = '' }) {
  const s = SIZES[size] || SIZES.sm;
  const alignClass = align === 'center' ? 'items-center' : 'items-start';

  // clamp() for fluid sizing between the mobile and desktop widths.
  const width = `clamp(${s.mobile}px, ${(s.mobile / 380) * 100}vw, ${s.desktop}px)`;

  return (
    <span className={`flex flex-col leading-none ${alignClass} ${className}`}>
      <img
        src={WORDMARK_IMAGE_SRC}
        alt="Stardust Garage"
        style={{ width, height: 'auto', display: 'block' }}
      />
    </span>
  );
}
