import type { NextConfig } from "next";

/** Set (server-only) when the site runs on the engine's laptop, e.g. http://localhost:8010. Unset on Vercel. */
const engineUrl = process.env.ENGINE_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  /**
   * On the laptop, /engine/* (the live WebSocket too) is passed through to the engine, so the browser
   * uses NEXT_PUBLIC_ENGINE_WS_URL=/engine and a phone needs only the site's address. Read at build
   * time: rebuild after changing ENGINE_URL.
   */
  async rewrites() {
    return engineUrl ? [{ source: "/engine/:path*", destination: `${engineUrl}/:path*` }] : [];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
