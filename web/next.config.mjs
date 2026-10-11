/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/audit", destination: "/check", permanent: true },
      { source: "/audit/:address", destination: "/check/:address", permanent: true },
    ];
  },
};

export default nextConfig;
