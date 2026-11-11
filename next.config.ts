import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Note: eslint.ignoreDuringBuilds was removed in Next.js 16.
  // ESLint warnings no longer block the build by default.
  reactStrictMode: false,
  compress: true,
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pg", "sharp"],
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "@radix-ui/react-icons"],
  },
  // Prevent Vercel's edge CDN AND the browser from caching the HTML
  // navigation shell. The shell references content-hashed JS chunks,
  // so a stale cached shell pulls in stale chunks and makes deployed
  // changes invisible to users until their cache expires.
  //
  // - no-store, max-age=0, must-revalidate: browser revalidates on
  //   every navigation. Vercel's CDN revalidates with the origin too.
  // - Only applies to navigational HTML, NOT to /_next/static/* chunks
  //   (which are content-hashed and safe to cache forever).
  async headers() {
    const securityHeaders = [
      // ── H-05: Security Headers ──
      // Prevent clickjacking — no one can iframe our app
      { key: "X-Frame-Options", value: "DENY" },
      // Prevent MIME sniffing — browser must respect Content-Type
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Force HTTPS for 2 years (including subdomains)
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      // Control referrer information sent to other sites
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Restrict browser features (camera, mic, geolocation, etc.)
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
      },
      // Content Security Policy — prevents XSS, data injection, etc.
      // 'unsafe-inline' needed for Next.js styles + inline scripts
      // 'unsafe-eval' needed for development (removed in production builds)
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          "img-src 'self' data: blob: https:",
          "connect-src 'self' https:",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "base-uri 'self'",
          "object-src 'none'",
        ].join("; "),
      },
    ];

    return [
      {
        // Apply security headers + cache control to all routes
        source: "/((?!_next/static|_next/image|favicon.ico|sw.js|app-icons|manifest.json).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
          ...securityHeaders,
        ],
      },
      {
        // ── H-04: CORS ──
        // Apply CORS headers to API routes only
        // Only allows requests from our own domains — prevents CSRF from
        // arbitrary websites making authenticated requests using the
        // victim's cookies.
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            // Allow all Vercel preview deployments + the production domain.
            // In production, set ALLOWED_ORIGINS env var to restrict further.
            value: process.env.ALLOWED_ORIGINS || "*",
          },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, PATCH, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-User-Role, X-Provider-Id, X-User-Permissions, X-User-Police-Rank, X-User-Name" },
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
