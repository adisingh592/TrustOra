/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Shared workspace packages (../../packages/*) live outside apps/web and must be transpiled.
    externalDir: true,
  },
  serverExternalPackages: ["@prisma/client", "prisma"],
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;

