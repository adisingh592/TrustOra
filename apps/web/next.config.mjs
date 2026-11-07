import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo root: ../../packages/* are imported by relative path and live outside apps/web.
  // Vercel's serverless bundler traces files from here to find them during the build.
  outputFileTracingRoot: path.join(__dirname, "../.."),
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

