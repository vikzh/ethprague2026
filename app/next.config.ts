import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Empty turbopack block silences the "webpack vs turbopack" warning; we have no webpack config.
  turbopack: {},
};

export default nextConfig;
