const values = [
  { title: 'Inclusive', desc: 'All are welcome' },
  { title: 'Authentic', desc: 'No corporate influence' },
  { title: 'Creative', desc: 'Artist-first approach' },
];

function SocialIcon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  if (name === 'email') {
    return (
      <svg {...common}>
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    );
  }
  if (name === 'instagram') {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export default function AboutPage() {
  return (
    <main className="max-w-[900px] mx-auto px-6 py-20">
      <h1 className="text-[32px] md:text-[46px] font-extrabold -tracking-[0.02em] mb-9 leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        ABOUT STARDUST GARAGE
      </h1>

      <div className="max-w-[760px]">
        <p className="text-[15px] leading-[1.7] mb-[22px]">
          Founded in 2014, Stardust Garage has been the beating heart of the underground music scene in the city. What started as a DIY venue in an abandoned garage has grown into a multifaceted creative hub that supports artists, musicians, and cultural innovators.
        </p>
        <p className="text-[15px] leading-[1.7] mb-[22px]">
          We believe in the power of raw, unfiltered artistic expression. Our spaces are designed to foster creativity, collaboration, and community. From late-night electronic sessions to intimate acoustic showcases, we provide a platform for emerging and established artists alike.
        </p>
        <p className="text-[15px] leading-[1.7] mb-[22px]">
          Beyond music, Stardust Garage serves as a coworking space for creatives, a rehearsal facility for local bands, and a gathering place for those who seek something different from mainstream culture.
        </p>
      </div>

      <div className="w-full rounded-[14px] overflow-hidden mt-12 mb-14 bg-[#111]" style={{ aspectRatio: '16 / 9' }}>
        <img
          src="https://images.unsplash.com/photo-1574434148043-f9a7adac1b00?w=1600&q=80"
          alt="Stardust Garage venue"
          className="w-full h-full object-cover"
        />
      </div>

      <div className="rounded-[18px] p-11 mb-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
        <h2 className="text-base font-bold tracking-[0.14em] mb-[22px]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          OUR MISSION
        </h2>
        <p className="text-[15px] leading-[1.65] mb-9">
          To cultivate an inclusive, underground cultural space where experimentation is encouraged, boundaries are pushed, and authentic connections are made through music and art.
        </p>
        <div className="h-px mb-8" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <div className="grid grid-cols-3 gap-6 text-center">
          {values.map((v) => (
            <div key={v.title}>
              <div className="text-[22px] font-bold -tracking-[0.01em] mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {v.title}
              </div>
              <div className="text-[13px]" style={{ color: '#8a8a8a' }}>{v.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[18px] p-11 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
        <h2 className="text-base font-bold tracking-[0.14em] mb-[22px]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          CONTACT
        </h2>
        <div className="text-[15px] leading-[1.8] mb-7">
          <p className="mb-2">123 Underground Ave, Downtown District</p>
          <p className="mb-2">Open Thu-Sat, 8PM-4AM</p>
        </div>
        <div className="flex gap-[18px]">
          {['email', 'instagram', 'facebook'].map((s) => (
            <a
              key={s}
              href="#"
              aria-label={s}
              className="w-[38px] h-[38px] flex items-center justify-center rounded-[10px] border transition-all hover:bg-white/5"
              style={{ borderColor: 'rgba(255,255,255,0.12)' }}
            >
              <SocialIcon name={s} />
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
