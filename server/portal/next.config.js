const SHARED = require('../shared/constants');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Same-origin /api/* → the ProjMan2 API, so the browser needs no CORS and the
  // dashboard needs no absolute base URL in dev. Default comes from the ONE shared
  // constants file (server/shared/constants.js) every ProjMan2 service reads its
  // default URLs from — API_URL env var still overrides it per-service if needed.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || SHARED.API_URL}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
