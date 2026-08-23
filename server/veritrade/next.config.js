/** @type {import('next').NextConfig} */
const nextConfig = {
  // Same-origin /api/* → the ProjMan2 API, so the browser needs no CORS and VeriTrade
  // needs no absolute base URL in dev. Same pattern as Portal/Dashboard.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:5100'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
