import Link from 'next/link';

const plans = [
  {
    name: 'Cowork',
    slug: 'cowork',
    price: '$155',
    period: '/ month',
    featured: false,
    tagline: 'For people who do their best work somewhere that isn’t home and isn’t a coffee shop.',
    benefits: [
      'Cowork access, 8AM – 6PM, Mon–Fri',
      '3 guest passes per month',
      'A community of artists, builders, and culturally aligned people',
    ],
  },
  {
    name: 'Cowork + Party',
    slug: 'cowork-party',
    price: '$225',
    period: '/ month',
    featured: true,
    tagline: 'For people who want their workdays here — and their weekends, too.',
    benefits: [
      'Everything in Cowork',
      '60% off SDG event tickets',
      'Members-only hours and experiences',
    ],
  },
];

const features = [
  {
    icon: 'wifi',
    title: 'Gigabit Fiber Internet',
    desc: 'Built for big uploads, video calls, and large files.',
  },
  {
    icon: 'bottle',
    title: 'Refreshments On Hand',
    desc: 'A stocked selection of healthy drinks and snacks, restocked regularly.',
  },
  {
    icon: 'users',
    title: 'A Curated Room',
    desc: 'Members and approved guests only. We keep the room small on purpose.',
  },
  {
    icon: 'home',
    title: 'Cozy By Design',
    desc: 'Warm lighting, soft surfaces, plants. Closer to a living room than an office.',
  },
  {
    icon: 'lock',
    title: 'Private Lockers',
    desc: 'Two sizes. Combination lock and a fast charger inside. Add-on for any membership.',
  },
  {
    icon: 'calendar',
    title: 'No Surprises',
    desc: 'Cowork runs Mon–Fri, business hours. Shows are weekends, after-hours.',
  },
];

function FeatureIcon({ name }) {
  const props = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  if (name === 'wifi')
    return (
      <svg {...props}>
        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
    );
  if (name === 'coffee')
    return (
      <svg {...props}>
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    );
  if (name === 'bottle')
    return (
      <svg {...props}>
        <path d="M10 2h4" />
        <path d="M10 2v3.2a3 3 0 0 1-.6 1.8L8.2 8.6A4 4 0 0 0 7.4 11v8a3 3 0 0 0 3 3h3.2a3 3 0 0 0 3-3v-8a4 4 0 0 0-.8-2.4L14.6 7A3 3 0 0 1 14 5.2V2" />
        <line x1="7.4" y1="13" x2="16.6" y2="13" />
      </svg>
    );
  if (name === 'users')
    return (
      <svg {...props}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  if (name === 'home')
    return (
      <svg {...props}>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    );
  if (name === 'lock')
    return (
      <svg {...props}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  if (name === 'calendar')
    return (
      <svg {...props}>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  return null;
}

function CheckIcon({ dark = false }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={dark ? '#0a0a0a' : '#f5f5f5'}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 4 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function MembersPage() {
  return (
    <main style={{ viewTransitionName: 'portal-members' }}>
      {/* THE SPACE */}
      <section
        id="space"
        className="max-w-[1100px] mx-auto px-6 pt-20 pb-20 md:pt-28 md:pb-28 scroll-mt-24"
      >
        <div className="mb-12 max-w-[640px]">
          <div
            className="text-[11px] font-semibold tracking-[0.28em] mb-3"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            MEMBERSHIP
          </div>
          <h1
            className="text-[28px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-5"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Built for focus.
            <br />
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>
              Designed for community.
            </span>
          </h1>
          <p
            className="text-[15px] leading-[1.65]"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            We optimized for the things that actually make a workday good — the
            internet, the people, the room.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-[14px] p-7 border transition-transform hover:-translate-y-1"
              style={{
                background: '#141418',
                borderColor: 'rgba(255,255,255,0.05)',
              }}
            >
              <div
                className="mb-5"
                style={{ color: 'rgba(255,255,255,0.85)' }}
              >
                <FeatureIcon name={f.icon} />
              </div>
              <h3
                className="text-[16px] font-bold mb-2"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {f.title}
              </h3>
              <p
                className="text-[13.5px] leading-[1.6]"
                style={{ color: 'rgba(255,255,255,0.6)' }}
              >
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* JOIN */}
      <section
        id="join"
        className="max-w-[1100px] mx-auto px-6 pb-20 md:pb-28 scroll-mt-24"
      >
        <div className="mb-12 max-w-[640px]">
          <div
            className="text-[11px] font-semibold tracking-[0.28em] mb-3"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            JOIN
          </div>
          <h2
            className="text-[28px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-5"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Two ways in.
          </h2>
          <p
            className="text-[15px] leading-[1.65]"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            One is a workday membership. The other adds a discount on every
            show we throw — for the people who want their nights here too.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {plans.map((plan) => {
            const isFeatured = plan.featured;
            return (
              <div
                key={plan.slug}
                className="relative rounded-[18px] p-9 md:p-10 border flex flex-col"
                style={{
                  background: isFeatured ? '#f5f5f0' : '#141418',
                  borderColor: isFeatured ? '#f5f5f0' : 'rgba(255,255,255,0.06)',
                  color: isFeatured ? '#0a0a0a' : '#f5f5f5',
                }}
              >
                {isFeatured && (
                  <div
                    className="absolute -top-3 left-9 px-3 py-1 rounded-full text-[10px] font-semibold tracking-[0.2em]"
                    style={{ background: '#0a0a0a', color: '#f5f5f0' }}
                  >
                    MOST CHOSEN
                  </div>
                )}
                <h3
                  className="text-[22px] font-bold -tracking-[0.01em] mb-2"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {plan.name}
                </h3>
                <p
                  className="text-[14px] leading-[1.55] mb-7"
                  style={{ color: isFeatured ? '#555' : 'rgba(255,255,255,0.6)' }}
                >
                  {plan.tagline}
                </p>

                <div className="flex items-baseline gap-2 mb-8">
                  <span
                    className="text-[44px] font-extrabold -tracking-[0.02em] leading-none"
                    style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  >
                    {plan.price}
                  </span>
                  <span
                    className="text-[13px]"
                    style={{ color: isFeatured ? '#666' : 'rgba(255,255,255,0.5)' }}
                  >
                    {plan.period}
                  </span>
                </div>

                <ul className="list-none mb-9 flex-1 space-y-2.5">
                  {plan.benefits.map((benefit) => (
                    <li
                      key={benefit}
                      className="flex items-start gap-3 text-[14px] leading-[1.55]"
                    >
                      <CheckIcon dark={isFeatured} />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/members/apply/${plan.slug}`}
                  className="w-full py-3.5 rounded-full text-[12px] font-semibold tracking-[0.2em] transition-all hover:-translate-y-0.5 text-center"
                  style={{
                    background: isFeatured ? '#0a0a0a' : '#f5f5f0',
                    color: isFeatured ? '#f5f5f0' : '#0a0a0a',
                  }}
                >
                  APPLY
                </Link>
              </div>
            );
          })}
        </div>

        {/* Lockers add-on */}
        <div
          className="mt-5 rounded-[18px] p-8 md:p-9 border flex flex-col md:flex-row md:items-center gap-7"
          style={{ background: '#141418', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div className="md:w-[260px] flex-shrink-0">
            <div
              className="text-[10px] font-semibold tracking-[0.24em] mb-2"
              style={{ color: 'rgba(255,255,255,0.45)' }}
            >
              ADD-ON
            </div>
            <h3
              className="text-[22px] font-bold -tracking-[0.01em] mb-1"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Lockers
            </h3>
            <p
              className="text-[12.5px]"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              Requires membership
            </p>
          </div>
          <ul className="list-none flex-1 space-y-2">
            <li className="flex items-start gap-3 text-[14px] leading-[1.55]">
              <CheckIcon />
              <span>Two sizes — small and large</span>
            </li>
            <li className="flex items-start gap-3 text-[14px] leading-[1.55]">
              <CheckIcon />
              <span>Combination lock and built-in fast charger</span>
            </li>
          </ul>
        </div>
      </section>

      {/* CLOSING */}
      <section className="max-w-[1100px] mx-auto px-6 pb-24 md:pb-32">
        <div
          className="rounded-[20px] border p-10 md:p-14 text-center"
          style={{
            borderColor: 'rgba(255,255,255,0.08)',
            background:
              'radial-gradient(120% 80% at 50% 0%, rgba(180,135,70,0.18) 0%, rgba(20,18,22,0.9) 60%, rgba(10,10,14,1) 100%)',
          }}
        >
          <h2
            className="text-[32px] md:text-[44px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-5"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Now accepting members.
          </h2>
          <p
            className="text-[15px] leading-[1.65] max-w-[480px] mx-auto mb-9"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            We accept on a rolling basis as the room has space. Tell us a
            little about yourself.
          </p>
          <Link
            href="/members/apply/cowork"
            className="inline-block px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.2em] transition-all hover:-translate-y-0.5"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            APPLY NOW
          </Link>
        </div>
      </section>
    </main>
  );
}
