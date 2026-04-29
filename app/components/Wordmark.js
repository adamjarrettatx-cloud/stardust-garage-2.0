// Reusable brand wordmark.
// Use this anywhere the Stardust Garage logo/identity should appear, so
// the typography stays consistent across the site.
//
// Sizes:
//   sm  — navbar
//   md  — admin login, footers, secondary headers
//   lg  — page heroes
//   xl  — homepage hero / splash

const SIZES = {
  sm: { stardust: 22, garage: 10, gap: 4 },
  md: { stardust: 40, garage: 14, gap: 6 },
  lg: { stardust: 72, garage: 22, gap: 8 },
  xl: { stardust: 110, garage: 44, gap: 10 },
};

export default function Wordmark({
  size = 'sm',
  align = 'start',
  color = '#ffffff',
  className = '',
}) {
  const s = SIZES[size] || SIZES.sm;
  const alignClass = align === 'center' ? 'items-center' : 'items-start';

  return (
    <span
      className={`flex flex-col leading-none ${alignClass} ${className}`}
      style={{ color }}
    >
      <span
        style={{
          fontFamily: "'Moshra Aesthetic', 'Cormorant Unicase', serif",
          fontWeight: 400,
          fontSize: s.stardust,
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
          fontSize: s.garage,
          letterSpacing: '0.32em',
          marginTop: s.gap,
        }}
      >
        GARAGE
      </span>
    </span>
  );
}
