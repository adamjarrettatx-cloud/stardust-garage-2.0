// Reusable brand wordmark.
// Use this anywhere the Stardust Garage logo/identity should appear, so
// the typography stays consistent across the site.
//
// Sizes (mobile / desktop):
//   sm  — navbar (22 / 22)
//   md  — admin login, footers, secondary headers (32 / 40)
//   lg  — page heroes (52 / 72)
//   xl  — homepage hero / splash (62 / 110)

const SIZES = {
  sm: {
    stardust: { mobile: 22, desktop: 22 },
    garage: { mobile: 10, desktop: 10 },
    gap: { mobile: 4, desktop: 4 },
  },
  md: {
    stardust: { mobile: 32, desktop: 40 },
    garage: { mobile: 12, desktop: 14 },
    gap: { mobile: 5, desktop: 6 },
  },
  lg: {
    stardust: { mobile: 52, desktop: 72 },
    garage: { mobile: 16, desktop: 22 },
    gap: { mobile: 7, desktop: 8 },
  },
  xl: {
    stardust: { mobile: 62, desktop: 110 },
    garage: { mobile: 24, desktop: 44 },
    gap: { mobile: 8, desktop: 10 },
  },
};

// The "xl" size (homepage hero / splash) renders the official wordmark artwork
// instead of live text, per the brand refresh. Other sizes keep the live
// text rendering below.
const WORDMARK_IMAGE_SRC = '/logos/wordmark-white.svg';
// Widths chosen so the rendered height roughly matches the previous live-text
// hero sizing (mobile ~94px tall, desktop ~164px tall) at the artwork's
// native 1006:376 aspect ratio.
const WORDMARK_IMAGE_SIZES = {
  xl: { mobile: 250, desktop: 440 },
};

export default function Wordmark({
  size = 'sm',
  align = 'start',
  color = '#ffffff',
  className = '',
}) {
  const s = SIZES[size] || SIZES.sm;
  const alignClass = align === 'center' ? 'items-center' : 'items-start';

  const imageSize = WORDMARK_IMAGE_SIZES[size];
  if (imageSize) {
    const width = `clamp(${imageSize.mobile}px, ${
      (imageSize.mobile / 380) * 100
    }vw, ${imageSize.desktop}px)`;
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

  // Use clamp() for fluid responsive sizing between mobile and desktop values
  const stardustSize = `clamp(${s.stardust.mobile}px, ${
    (s.stardust.mobile / 380) * 100
  }vw, ${s.stardust.desktop}px)`;
  const garageSize = `clamp(${s.garage.mobile}px, ${
    (s.garage.mobile / 380) * 100
  }vw, ${s.garage.desktop}px)`;
  const gapSize = `clamp(${s.gap.mobile}px, ${
    (s.gap.mobile / 380) * 100
  }vw, ${s.gap.desktop}px)`;

  return (
    <span
      className={`flex flex-col leading-none ${alignClass} ${className}`}
      style={{ color }}
    >
      <span
        style={{
          fontFamily: "'Moshra Aesthetic', 'Cormorant Unicase', serif",
          fontWeight: 400,
          fontSize: stardustSize,
          letterSpacing: '0.02em',
          lineHeight: 0.9,
        }}
      >
        STARDUST
      </span>
      <span
        style={{
          fontFamily: "'Inter', sans-serif",
          fontWeight: 400,
          fontSize: garageSize,
          letterSpacing: '0.32em',
          marginTop: gapSize,
        }}
      >
        GARAGE
      </span>
    </span>
  );
}
