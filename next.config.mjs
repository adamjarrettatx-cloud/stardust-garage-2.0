/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{
      source: '/clock/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') + "; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'" },
      ],
    }];
  },
  outputFileTracingIncludes: {
    // sharp resolves native addons and libvips at runtime. Next 15's tracing
    // can omit these optional platform packages even when the build succeeds.
    // Include both packages (and the email SVG) in Node API function bundles.
    '/api/**/*': [
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-*/**/*',
      './public/logos/wordmark-white.svg',
    ],
    '/api/portal/w9': ['./lib/w9/assets/fw9.pdf'],
    '/api/portal/w9/blank': ['./lib/w9/assets/fw9.pdf'],
  },
  async redirects() {
    return [
      // Cowork merged into Memberships — preserve any old links.
      { source: '/cowork', destination: '/members', permanent: true },

      // Short manual-fallback aliases for the Jelly2 door setup links, so a
      // token can be typed by hand on the tiny keyboard if the QR can't be
      // scanned. Next.js forwards the query string automatically, so
      // /c/f?token=… lands on /capacity/front-door?token=… with the token
      // intact — the door page still requires and verifies the token exactly
      // as before (no auth relaxation here; these are pure path aliases).
      { source: '/c/f', destination: '/capacity/front-door', permanent: false },
      { source: '/c/e', destination: '/capacity/exit-door', permanent: false },

      // Partner → Portal rename. The URL namespace moved from /partner/* to
      // /portal/* so it is role-agnostic (a contact can be a DJ AND a promoter,
      // and "partner" was internal dev-speak that leaked into the UI). 308
      // permanent so cached bookmarks, saved links in invite emails already in
      // people's inboxes, and any browser autocomplete still resolve. Keep this
      // in place for at least 90 days before removing.
      { source: '/partner', destination: '/portal', permanent: true },
      { source: '/partner/:path*', destination: '/portal/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
