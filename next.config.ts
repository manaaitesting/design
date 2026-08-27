import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: false, // canvas pointer/RAF loops double-fire under strict mode
};

export default nextConfig;
