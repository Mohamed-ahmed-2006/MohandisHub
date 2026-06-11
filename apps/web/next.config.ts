import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

const apiTarget = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const imageRemoteUrls = [
  process.env.NEXT_PUBLIC_API_URL,
  process.env.API_PUBLIC_URL,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_URL,
  process.env.WEB_PUBLIC_URL,
  process.env.NEXT_PUBLIC_WEB_URL,
].filter((value): value is string => Boolean(value && value.trim()));

const remoteImagePatterns = [
  { protocol: 'http' as const, hostname: 'localhost', pathname: '/**' },
  { protocol: 'http' as const, hostname: '127.0.0.1', pathname: '/**' },
  { protocol: 'https' as const, hostname: 'localhost', pathname: '/**' },
  ...imageRemoteUrls.flatMap((raw) => {
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      return [
        {
          protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
          hostname: parsed.hostname,
          pathname: '/**',
        },
      ];
    } catch {
      return [];
    }
  }),
].filter(
  (pattern, index, arr) =>
    arr.findIndex(
      (item) => item.protocol === pattern.protocol && item.hostname === pattern.hostname,
    ) === index,
);

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  transpilePackages: ['@mohandishub/shared'],
  images: {
    remotePatterns: remoteImagePatterns,
  },
  rewrites() {
    return Promise.resolve([
      {
        source: '/api/:path((?!proxy/).*)',
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

export default withBundleAnalyzer(nextConfig);
