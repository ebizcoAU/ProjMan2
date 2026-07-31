/** @type {import('next').NextConfig} */
const nextConfig = {
  // Same-origin /api/* → the ProjMan2 API, so the browser needs no CORS and the
  // dashboard needs no absolute base URL in dev.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:4100'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
