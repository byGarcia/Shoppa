import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// Strict-Transport-Security is NOT here: headers() is resolved during
// `next build` and baked into .next/routes-manifest.json, and next.config.ts is
// never copied into the runner image, so no runtime variable can reach it. It
// is set per response from APP_ORIGIN in src/proxy.ts instead.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()", "autoplay=(self)", "camera=()", "display-capture=()",
      "fullscreen=(self)", "geolocation=()", "gyroscope=()", "microphone=()",
      "midi=()", "payment=()", "publickey-credentials-get=(self)",
      "publickey-credentials-create=(self)", "screen-wake-lock=(self)", "usb=()",
    ].join(", "),
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@simplewebauthn/server"],
  output: "standalone",
  experimental: { optimizePackageImports: ["lucide-react"] },
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, private" },
          { key: "Vary", value: "Cookie" },
        ],
      },
    ];
  },
};

// Points next-intl at src/i18n/request.ts, which resolves the locale per
// request from the NEXT_LOCALE cookie.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
