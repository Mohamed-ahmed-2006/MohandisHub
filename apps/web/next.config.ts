import type { NextConfig } from 'next';

const apiTarget = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  transpilePackages: ['@mohandishub/shared'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', pathname: '/**' },
      { protocol: 'https', hostname: '**', pathname: '/**' },
    ],
  },
  rewrites() {
    return Promise.resolve([
      {
        source: '/api/:path*',
        destination: `${apiTarget}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${apiTarget}/health`,
      },
      { source: '/favicon.ico', destination: '/icon' },
    ]);
  },
};

export default nextConfig;
