'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

const links = [
  { href: '/events', label: 'EVENTS' },
  { href: '/members', label: 'MEMBERSHIP' },
  { href: '/venue-rental', label: 'VENUE RENTAL' },
  {
    label: 'COLLABORATE',
    href: '/collaborate',
    dropdown: [
      { href: '/collaborate/djs', label: 'DJs' },
      { href: '/collaborate/artists', label: 'Artists' },
    ],
  },
];

export default function NavLinks() {
  const pathname = usePathname();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(null);
  const dropdownRef = useRef(null);

  const isActive = (href) => {
    if (href === '/events') return pathname === '/events' || pathname.startsWith('/events/');
    return pathname === href || pathname.startsWith(href + '/');
  };

  // Close desktop dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileOpen(false);
    setMobileExpanded(null);
  }, [pathname]);

  return (
    <>
      {/* DESKTOP NAV */}
      <ul className="hidden md:flex gap-9 list-none items-center">
        {links.map((link) => {
          if (link.dropdown) {
            const isOpen = openDropdown === link.label;
            const isDropdownActive = link.dropdown.some((d) => isActive(d.href));
            return (
              <li key={link.label} className="relative" ref={isOpen ? dropdownRef : null}>
                <button
                  type="button"
                  onClick={() => setOpenDropdown(isOpen ? null : link.label)}
                  className="text-[13px] font-medium tracking-[0.12em] transition-colors flex items-center gap-1.5"
                  style={{ color: isDropdownActive || isOpen ? '#f5f5f5' : '#8a8a8a' }}
                >
                  {link.label}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isOpen && (
                  <div
                    className="absolute top-full right-0 mt-3 rounded-[12px] border overflow-hidden min-w-[160px]"
                    style={{
                      background: '#141414',
                      borderColor: 'rgba(255,255,255,0.1)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    }}
                  >
                    {link.dropdown.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpenDropdown(null)}
                        className="block px-5 py-3 text-[13px] font-medium tracking-[0.08em] transition-colors hover:bg-white/5"
                        style={{ color: isActive(item.href) ? '#f5f5f5' : '#c0c0c0' }}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          }

          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-[13px] font-medium tracking-[0.12em] transition-colors"
                style={{ color: isActive(link.href) ? '#f5f5f5' : '#8a8a8a' }}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* MOBILE HAMBURGER BUTTON */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden p-2 -mr-2"
        aria-label="Open menu"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f5f5f5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* MOBILE MENU OVERLAY */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50"
          style={{ background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(10px)' }}
        >
          <div className="flex items-center justify-between px-6 pt-8">
            <span className="text-[11px] font-semibold tracking-[0.2em]" style={{ color: '#8a8a8a' }}>
              MENU
            </span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="p-2 -mr-2"
              aria-label="Close menu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f5f5f5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <nav className="px-6 pt-16">
            <ul className="list-none space-y-2">
              {links.map((link) => {
                if (link.dropdown) {
                  const isExpanded = mobileExpanded === link.label;
                  return (
                    <li key={link.label}>
                      <button
                        type="button"
                        onClick={() => setMobileExpanded(isExpanded ? null : link.label)}
                        className="w-full flex items-center justify-between py-5 text-left border-b"
                        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                      >
                        <span
                          className="text-[22px] font-extrabold -tracking-[0.01em]"
                          style={{
                            fontFamily: "'Plus Jakarta Sans', sans-serif",
                            color: '#f5f5f5',
                          }}
                        >
                          {link.label}
                        </span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#8a8a8a"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            transition: 'transform 0.2s',
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                          }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <ul className="list-none pl-4 py-3 space-y-3">
                          {link.dropdown.map((item) => (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className="block text-[16px] font-medium tracking-[0.06em] py-1.5"
                                style={{ color: '#c0c0c0' }}
                              >
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                }

                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="block py-5 border-b text-[22px] font-extrabold -tracking-[0.01em]"
                      style={{
                        borderColor: 'rgba(255,255,255,0.08)',
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        color: isActive(link.href) ? '#f5f5f5' : '#c0c0c0',
                      }}
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
