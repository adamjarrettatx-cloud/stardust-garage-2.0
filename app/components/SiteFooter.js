import Link from 'next/link';
import SignupForm from './SignupForm';

const navLinks = [
  { label: 'Venue Rental', href: '/venue-rental' },
  { label: 'DJs', href: '/collaborate/djs' },
  { label: 'Artists', href: '/collaborate/artists' },
  { label: 'Internship', href: '/collaborate/internship' },
  { label: 'Member Login', href: '/login' },
];

export default function SiteFooter() {
  return (
    <footer
      className="relative mt-24 px-6 pt-20 pb-10 border-t"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
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
              style={{ color: '#8a8a8a' }}
            >
              CONTACT
            </h3>
            <a
              href="mailto:hello@sdgatx.com"
              className="block text-[14px] hover:opacity-70 transition-opacity"
              style={{ color: '#d0d0d0' }}
            >
              hello@sdgatx.com
            </a>
            <a
              href="https://wa.me/17374233300"
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-2 text-[14px] hover:opacity-70 transition-opacity"
              style={{ color: '#d0d0d0' }}
            >
              (737) 423-3300
            </a>
          </div>

          <div>
            <h3
              className="text-[11px] font-semibold tracking-[0.2em] mb-4"
              style={{ color: '#8a8a8a' }}
            >
              HOURS
            </h3>
            <div className="text-[14px] space-y-1.5" style={{ color: '#d0d0d0' }}>
              <p>Mon–Fri: 8AM – 5PM</p>
              <p>Wknd: see schedule</p>
            </div>
          </div>

          <div>
            <h3
              className="text-[11px] font-semibold tracking-[0.2em] mb-4"
              style={{ color: '#8a8a8a' }}
            >
              MORE
            </h3>
            <ul className="space-y-2">
              {navLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[14px] hover:opacity-70 transition-opacity"
                    style={{ color: '#d0d0d0' }}
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
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <div className="text-[12px]" style={{ color: '#8a8a8a' }}>
            © {new Date().getFullYear()} Stardust Garage
          </div>

        </div>
      </div>
    </footer>
  );
}
