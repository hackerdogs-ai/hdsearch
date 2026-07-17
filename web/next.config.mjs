/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // slim Docker runtime
  images: {
    // user avatars (Auth0/Gravatar) + result thumbnails come from arbitrary hosts
    remotePatterns: [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: '**' }],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/icon.svg',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/favicon.ico',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  async rewrites() {
    // Browsers still request /favicon.ico by default; app/icon.svg is the canonical icon.
    return [{ source: '/favicon.ico', destination: '/icon.svg' }];
  },
};
export default nextConfig;
