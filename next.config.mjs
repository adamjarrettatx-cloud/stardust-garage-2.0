/** @type {import('next').NextConfig} */
const nextConfig = {
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
    ];
  },
};

export default nextConfig;
