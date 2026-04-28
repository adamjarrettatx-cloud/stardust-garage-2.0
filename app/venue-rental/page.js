import Link from 'next/link';
import VenueShowcase from './VenueShowcase';

const venues = [
  {
    name: 'Micro Parties / Birthdays',
    slug: 'micro-parties',
    icon: 'users',
    startingPrice: 'Starting at $125/hr',
    features: [
      'Turn-key (just show up and party)',
      'Up to 44 people',
      'Currently only available 7pm and later M–Th',
    ],
  },
  {
    name: 'Host-Your-Own Experiences',
    slug: 'host-your-own',
    icon: 'spark',
    features: [
      'Creators',
      'Workshops',
      'Facilitators',
    ],
  },
  {
    name: 'Entire Space',
    slug: 'entire-space',
    icon: 'building',
    features: [
      'Weekends only',
      'Turn-key',
      'Work with SDG team to curate your event',
    ],
  },
];

function VenueIcon({ name }) {
  const common = {
    width: 32,
    height: 32,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: { flexShrink: 0, marginTop: 2 },
  };
  if (name === 'users') {
    return (
      <svg {...common}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (name === 'spark') {
    return (
      <svg {...common}>
        <path d="M12 2v4" />
        <path d="M12 18v4" />
        <path d="m4.93 4.93 2.83 2.83" />
        <path d="m16.24 16.24 2.83 2.83" />
        <path d="M2 12h4" />
        <path d="M18 12h4" />
        <path d="m4.93 19.07 2.83-2.83" />
        <path d="m16.24 7.76 2.83-2.83" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

export default function VenueRentalPage() {
  return (
    <main className="max-w-[1100px] mx-auto px-6 py-20 md:py-24">
      {/* Hero */}
      <header className="mb-12 md:mb-16 max-w-[760px]">
        <div
          className="text-[11px] font-semibold tracking-[0.28em] mb-5"
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          VENUE RENTAL
        </div>
        <h1
          className="leading-[1.05] -tracking-[0.02em] mb-7"
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 700,
            fontSize: 'clamp(28px, 3.4vw, 40px)',
          }}
        >
          Rent the venue.
        </h1>
        <p
          className="text-[15px] md:text-[16px] leading-[1.65] max-w-[600px]"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          The system, the room, and the booth are already here — set up,
          tuned, and ready. You bring the night.
        </p>
      </header>

      {/* Flagship inclusions showcase */}
      <VenueShowcase />

      {/* Rental options */}
      <section className="mt-20 md:mt-28">
        <div className="mb-10 max-w-[640px]">
          <div
            className="text-[11px] font-semibold tracking-[0.28em] mb-3"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            OPTIONS
          </div>
          <h2
            className="text-[28px] md:text-[36px] font-extrabold -tracking-[0.02em] leading-[1.05]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Rent the room.
          </h2>
        </div>

        <div className="flex flex-col gap-5">
        {venues.map((venue) => (
          <div
            key={venue.slug}
            className="rounded-[18px] p-7 md:p-10 border flex flex-col md:flex-row md:items-center gap-6 md:gap-8"
            style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
          >
            <div className="flex-1">
              <div className="flex items-start gap-4 mb-[18px] md:mb-[22px]">
                <VenueIcon name={venue.icon} />
                <div className="text-[20px] md:text-[22px] font-bold -tracking-[0.01em]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {venue.name}
                </div>
              </div>
              <ul className="list-none">
                {venue.features.map((feature) => (
                  <li key={feature} className="pl-4 text-sm leading-[1.9] relative">
                    <span className="absolute left-0">•</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col md:items-end gap-3 md:min-w-[180px]">
              {venue.startingPrice && (
                <div
                  className="text-[13px] font-medium"
                  style={{ color: '#8a8a8a' }}
                >
                  {venue.startingPrice}
                </div>
              )}
              <Link
                href={venue.slug === 'micro-parties' ? '/venue-rental/inquire/micro-parties' : `/venue-rental/inquire?type=${venue.slug}`}
                className="w-full md:w-auto text-center px-[22px] py-3 md:py-2.5 rounded-full text-xs font-semibold tracking-[0.12em] hover:bg-gray-200 transition-all hover:-translate-y-0.5 whitespace-nowrap"
                style={{ background: '#ffffff', color: '#0a0a0a' }}
              >
                INQUIRE
              </Link>
            </div>
          </div>
        ))}
        </div>
      </section>

      {/* Also included */}
      <div
        className="rounded-[18px] p-10 md:p-12 mt-14 mb-14 border"
        style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <h2
          className="text-[11px] font-semibold tracking-[0.28em] mb-7"
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          ALSO INCLUDED
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div>
            <h3
              className="text-base font-bold mb-[14px]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Staff
            </h3>
            <ul
              className="list-none text-sm leading-[1.95]"
              style={{ color: '#8a8a8a' }}
            >
              <li>Bar staff</li>
              <li>Security personnel (if required)</li>
              <li>Setup and breakdown assistance</li>
            </ul>
          </div>
          <div>
            <h3
              className="text-base font-bold mb-[14px]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Services
            </h3>
            <ul
              className="list-none text-sm leading-[1.95]"
              style={{ color: '#8a8a8a' }}
            >
              <li>Coat check</li>
              <li>Ticket scanning system</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="text-center py-8 md:py-10">
        <p className="text-[15px] mb-5 md:mb-6" style={{ color: '#8a8a8a' }}>
          Interested in hosting an event? Get in touch for availability and custom packages.
        </p>
        <Link
          href="/venue-rental/inquire"
          className="inline-block px-11 py-4 rounded-full text-[13px] font-semibold tracking-[0.14em] hover:bg-gray-200 transition-all hover:-translate-y-0.5"
          style={{ background: '#ffffff', color: '#0a0a0a' }}
        >
          INQUIRE
        </Link>
      </div>
    </main>
  );
}
