import type { NextConfig } from "next";

// The browser only talks to this origin; /api/* is proxied to the FastAPI service. That keeps the
// session cookie first-party and removes any need for cross-origin (CORS) requests in the UI.
const apiUrl = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
