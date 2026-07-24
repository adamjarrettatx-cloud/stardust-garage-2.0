import Link from 'next/link';
import SignupForm from './SignupForm';

const navLinks = [
  { label: 'Venue Rental', href: '/venue-rental' },
  { label: 'DJs', href: '/collaborate/djs' },
  { label: 'Artists', href: '/collaborate/artists' },
  { label: 'Member Login', href: '/login' },
];

function SocialIcon({ name }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  if (name === 'instagram') {
    return (
      <svg {...props}>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  }
  if (name === 'youtube') {
    return (
      <svg {...props} fill="currentColor" stroke="none">
        <path d="M23.5 6.5c-.3-1-1-1.8-2-2C19.5 4 12 4 12 4s-7.5 0-9.5.5c-1 .3-1.8 1-2 2C0 8.5 0 12 0 12s0 3.5.5 5.5c.3 1 1 1.8 2 2C4.5 20 12 20 12 20s7.5 0 9.5-.5c1-.3 1.8-1 2-2 .5-2 .5-5.5.5-5.5s0-3.5-.5-5.5zM9.5 15.5v-7l6 3.5-6 3.5z" />
      </svg>
    );
  }
  return null;
}

export default function SiteFooter() {
  return (
    <footer
      className="relative mt-24 px-6 pt-20 pb-10 border-t"
      style={{ borderColor: 'var(--fg-a06)' }}
    >
      <div className="max-w-[1100px] mx-auto">
        {/* Email/phone signup */}
        <div className="mb-20">
          <SignupForm />
        </div>

        {/* Contact + nav grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-10 mb-16">
          <div>
            <h3
              className="text-[11px] font-semibold tracking-[0.2em] mb-4"
              style={{ color: 'var(--text-3)' }}
            >
              CONTACT
            </h3>
            <a
              href="mailto:hello@sdgatx.com"
              className="block text-[14px] hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-2)' }}
            >
              hello@sdgatx.com
            </a>
            <a
              href="https://wa.me/17374233300"
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-2 text-[14px] hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-2)' }}
            >
              (737) 423-3300
            </a>
          </div>

          <div>
            <h3
              className="text-[11px] font-semibold tracking-[0.2em] mb-4"
              style={{ color: 'var(--text-3)' }}
            >
              HOURS
            </h3>
            <div className="text-[14px] space-y-1.5" style={{ color: 'var(--text-2)' }}>
              <p>Mon–Fri: 8AM – 6PM</p>
              <p>Wknd: see schedule</p>
            </div>
          </div>

          <div>
            <h3
              className="text-[11px] font-semibold tracking-[0.2em] mb-4"
              style={{ color: 'var(--text-3)' }}
            >
              MORE
            </h3>
            <ul className="space-y-2">
              {navLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[14px] hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div
          className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pt-8 border-t"
          style={{ borderColor: 'var(--fg-a06)' }}
        >
          <div className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            © {new Date().getFullYear()} Stardust Garage
          </div>

          <div className="flex gap-3">
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="w-10 h-10 rounded-full flex items-center justify-center border transition-all hover:bg-white/5 hover:-translate-y-0.5"
              style={{ borderColor: 'var(--fg-a12)', color: 'var(--text-1)' }}
            >
              <SocialIcon name="instagram" />
            </a>
            <a
              href="https://youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
              className="w-10 h-10 rounded-full flex items-center justify-center border transition-all hover:bg-white/5 hover:-translate-y-0.5"
              style={{ borderColor: 'var(--fg-a12)', color: 'var(--text-1)' }}
            >
              <SocialIcon name="youtube" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
