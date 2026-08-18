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
      { href: '/collaborate/internship', label: 'Internship' },
    ],
  },
];

export default function NavLinks() {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith('/bananas') || pathname?.startsWith('/team');
  const [openDropdown, setOpenDropdown] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(null);
  const dropdownRef = useRef(null);
  const palette = isAuthRoute
    ? {
        active: '#f5f5f5',
        inactive: '#8a8a8a',
        dropdownBg: 'rgba(8,8,12,0.94)',
        dropdownBorder: 'rgba(255,255,255,0.1)',
        dropdownText: '#c0c0c0',
        dropdownHover: 'var(--auth-hover-bg)',
        menuBg: 'rgba(3,3,6,0.96)',
        menuBorder: 'rgba(255,255,255,0.08)',
        menuMuted: '#8a8a8a',
        menuText: '#f5f5f5',
        menuTextInactive: '#c0c0c0',
        icon: '#f5f5f5',
        iconMuted: '#8a8a8a',
      }
    : {
        active: '#f5f5f5',
        inactive: '#8a8a8a',
        dropdownBg: '#141414',
        dropdownBorder: 'rgba(255,255,255,0.1)',
        dropdownText: '#c0c0c0',
        dropdownHover: 'rgba(255,255,255,0.05)',
        menuBg: 'rgba(0,0,0,0.95)',
        menuBorder: 'rgba(255,255,255,0.08)',
        menuMuted: '#8a8a8a',
        menuText: '#f5f5f5',
        menuTextInactive: '#c0c0c0',
        icon: '#f5f5f5',
        iconMuted: '#8a8a8a',
      };

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
                  style={{ color: isDropdownActive || isOpen ? palette.active : palette.inactive }}
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
                      background: palette.dropdownBg,
                      borderColor: palette.dropdownBorder,
                      boxShadow: isAuthRoute ? '0 12px 28px rgba(0,0,0,0.14)' : '0 8px 24px rgba(0,0,0,0.5)',
                    }}
                  >
                    {link.dropdown.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpenDropdown(null)}
                        className="auth-nav-dropdown-item block px-5 py-3 text-[13px] font-medium tracking-[0.08em] transition-colors"
                        style={{
                          color: isActive(item.href) ? palette.active : palette.dropdownText,
                          background: 'transparent',
                        }}
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
                style={{ color: isActive(link.href) ? palette.active : palette.inactive }}
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
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={palette.icon} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* MOBILE MENU OVERLAY */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50"
          style={{ background: palette.menuBg, backdropFilter: 'blur(10px)' }}
        >
          <div className="flex items-center justify-between px-6 pt-8">
            <span className="text-[11px] font-semibold tracking-[0.2em]" style={{ color: palette.menuMuted }}>
              MENU
            </span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="p-2 -mr-2"
              aria-label="Close menu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={palette.icon} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                        style={{ borderColor: palette.menuBorder }}
                      >
                        <span
                          className="text-[22px] font-extrabold -tracking-[0.01em]"
                          style={{
                            fontFamily: "'Plus Jakarta Sans', sans-serif",
                            color: palette.menuText,
                          }}
                        >
                          {link.label}
                        </span>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={palette.iconMuted}
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
                                style={{ color: palette.menuTextInactive }}
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
                        borderColor: palette.menuBorder,
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        color: isActive(link.href) ? palette.menuText : palette.menuTextInactive,
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
