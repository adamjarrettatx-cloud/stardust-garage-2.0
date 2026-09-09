import Link from 'next/link';

const plans = [
  {
    name: 'The Weekender',
    slug: 'weekender',
    price: '$48',
    period: '/ month',
    featured: false,
    kicker: 'FOR THE WEEKEND CROWD',
    tagline: 'Your entry to music experiences Friday thru Sunday — for less.',
    benefits: [
      '25% off Music & Party tickets, every weekend',
    ],
  },
  {
    name: 'The Builder',
    slug: 'cowork',
    price: '$155',
    period: '/ month',
    featured: false,
    kicker: 'FOR THE WORKDAY',
    tagline: 'For people who do their best work somewhere that isn’t home and that isn’t a traditional coffee shop.',
    benefits: [
      'Cowork access, 8AM – 5PM, Mon–Fri',
      'Gigabit fiber, refreshments, curated room',
      '3 guest passes per month',
      'A community of artists, builders, and culturally aligned people',
    ],
  },
  {
    // NOTE: slug stays 'cowork-party' — renaming would ripple through Stripe,
    // activation, applications, and existing member records. Only the display
    // name changes (previously "IYKYK", then "Experience", now "The Insider").
    name: 'The Insider',
    slug: 'cowork-party',
    price: '$225',
    period: '/ month',
    featured: false,
    kicker: 'WORKDAYS + WEEKENDS',
    tagline: 'The true Stardust Garage experience.',
    benefits: [
      'Everything in The Builder + The Weekender',
      'Up to 60% off SDG event tickets',
      'Insider-only hours and experiences',
      'The Insider only access line to shows',
      'Priority access to Space Rentals',
      'Exclusive Studio Rental Access',
      'Unlisted benefits',
    ],
  },
];

function CheckIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f5f5f5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 4 }}><polyline points="20 6 9 17 4 12" /></svg>);
}

export default function MembersPage() {
  return (
    <main style={{ viewTransitionName: 'portal-members' }}>
      {/* JOIN — tiles now lead the page */}
      <section id="join" className="max-w-[1100px] mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-20 scroll-mt-24">
        <div className="mb-12 max-w-[720px]">
          <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>MEMBERSHIP</div>
          <h1 className="text-[28px] md:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Three ways to belong.
          </h1>
          <p className="text-[15px] leading-[1.65]" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Apply for the tier that fits how you want to spend your time with us. Every membership is application-based and accepted on a rolling basis.
          </p>
        </div>

        {/* Trial Pass placeholder — highlighted gold band above the three tiles.
            Disabled/greyed-out on purpose until the /pass flow is wired up here;
            existing at /pass. See TODO below when ready to go live. */}
        <div
          aria-disabled="true"
          className="relative mb-8 rounded-[18px] p-7 md:p-8 border flex flex-col md:flex-row md:items-center gap-6 md:gap-8"
          style={{
            background: 'linear-gradient(180deg, rgba(217,196,140,0.06), rgba(255,255,255,0.015))',
            borderColor: 'rgba(217,196,140,0.55)',
            boxShadow: '0 0 0 1px rgba(217,196,140,0.12), 0 30px 60px -30px rgba(217,196,140,0.20)',
            cursor: 'not-allowed',
            opacity: 0.75,
          }}
        >
          <div
            className="absolute -top-2.5 left-7 text-[10px] font-semibold tracking-[0.28em] px-2.5 py-1 rounded-full"
            style={{ background: '#d9c48c', color: '#111' }}
          >
            COMING SOON
          </div>

          <div className="flex-1">
            <div className="text-[10px] font-semibold tracking-[0.28em] mb-2" style={{ color: 'rgba(217,196,140,0.85)' }}>
              TRY US BEFORE YOU JOIN
            </div>
            <h3 className="text-[22px] font-bold -tracking-[0.01em] mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              The 30-Day Trial Pass
            </h3>
            <p className="text-[14px] leading-[1.55] max-w-[560px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
              One first visit, thirty days to decide if we&rsquo;re home. Your window starts the night you walk in, not the day you sign up.
            </p>
          </div>

          <div className="flex-shrink-0 w-full md:w-auto">
            {/* TODO(trial-pass): swap this <button disabled> for
                  <Link href="/pass">CLAIM MY PASS</Link>
                when Adam gives the go-ahead. Route already exists in production. */}
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="w-full md:w-auto md:min-w-[200px] px-8 py-3.5 rounded-full text-[12px] font-semibold tracking-[0.28em] text-center"
              style={{
                background: 'transparent',
                color: 'rgba(255,255,255,0.55)',
                border: '1px solid rgba(217,196,140,0.45)',
                cursor: 'not-allowed',
              }}
            >
              COMING SOON
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {plans.map((plan) => (
            <div key={plan.slug} className="relative rounded-[18px] p-9 md:p-10 border flex flex-col" style={{ background: '#111', borderColor: 'rgba(255,255,255,0.06)', color: '#f5f5f5' }}>
              <div className="text-[10px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>{plan.kicker}</div>
              <h3 className="text-[22px] font-bold -tracking-[0.01em] mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{plan.name}</h3>
              <p className="text-[14px] leading-[1.55] mb-7" style={{ color: 'rgba(255,255,255,0.6)' }}>{plan.tagline}</p>

              <div className="flex items-baseline gap-2 mb-8">
                <span className="text-[36px] md:text-[44px] font-extrabold -tracking-[0.02em] leading-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{plan.price}</span>
                <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{plan.period}</span>
              </div>

              <ul className="list-none mb-9 flex-1 space-y-2.5">
                {plan.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3 text-[14px] leading-[1.55]">
                    <CheckIcon />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>

              <Link href={`/members/apply/${plan.slug}`} className="w-full py-3.5 rounded-full text-[12px] font-semibold tracking-[0.2em] transition-all hover:-translate-y-0.5 text-center" style={{ background: '#ffffff', color: '#0a0a0a' }}>APPLY</Link>
            </div>
          ))}
        </div>
      </section>

      {/* THE SPACE — Lockers add-on */}
      <section id="space" className="max-w-[1100px] mx-auto px-6 pb-20 md:pb-28 scroll-mt-24">
        {/* Lockers add-on */}
        <div className="mt-5 rounded-[18px] p-8 md:p-9 border flex flex-col md:flex-row md:items-center gap-7" style={{ background: '#111', borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="md:w-[260px] flex-shrink-0">
            <div className="text-[10px] font-semibold tracking-[0.24em] mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>ADD-ON</div>
            <h3 className="text-[22px] font-bold -tracking-[0.01em] mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Lockers</h3>
            <p className="text-[12.5px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Requires membership</p>
          </div>
          <ul className="list-none flex-1 space-y-2">
            <li className="flex items-start gap-3 text-[14px] leading-[1.55]"><CheckIcon /><span>Two sizes — small and large</span></li>
            <li className="flex items-start gap-3 text-[14px] leading-[1.55]"><CheckIcon /><span>Combination lock and built-in fast charger</span></li>
          </ul>
        </div>
      </section>

      {/* CLOSING */}
      <section className="max-w-[1100px] mx-auto px-6 pb-24 md:pb-32">
        <div className="rounded-[20px] border p-10 md:p-14 text-center" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'radial-gradient(120% 80% at 50% 0%, rgba(138,81,9,0.18) 0%, rgba(10,10,10,0.9) 60%, rgba(10,10,10,1) 100%)' }}>
          <h2 className="text-[32px] md:text-[44px] font-extrabold -tracking-[0.02em] leading-[1.05] mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Now accepting members.</h2>
          <p className="text-[15px] leading-[1.65] max-w-[480px] mx-auto mb-9" style={{ color: 'rgba(255,255,255,0.6)' }}>
            We accept on a rolling basis as the room has space. Tell us a little about yourself.
          </p>
          <Link href="/members/apply/cowork" className="inline-block px-8 py-4 rounded-full text-[12px] font-semibold tracking-[0.2em] transition-all hover:-translate-y-0.5" style={{ background: '#ffffff', color: '#0a0a0a' }}>APPLY NOW</Link>
        </div>
      </section>
    </main>
  );
}
