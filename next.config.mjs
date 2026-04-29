/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Cowork merged into Memberships — preserve any old links.
      { source: '/cowork', destination: '/members', permanent: true },
    ];
  },
};

export default nextConfig;
