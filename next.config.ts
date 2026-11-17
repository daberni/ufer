import type { NextConfig } from "next";

// Ufer uses none of these browser features.
const disabledBrowserFeatures = [
  "accelerometer",
  "autoplay",
  "bluetooth",
  "browsing-topics",
  "camera",
  "display-capture",
  "encrypted-media",
  "geolocation",
  "gyroscope",
  "hid",
  "idle-detection",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking"
];

const permissionsPolicy = disabledBrowserFeatures.map((feature) => `${feature}=()`).join(", ");

// A fixed policy: inline scripts and styles stay allowed because Next.js inlines its page data, everything else is limited to this origin. React needs eval in development for its error stacks.
const scriptSources = process.env.NODE_ENV === "development" ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSources}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./drizzle/sqlite/**/*"]
  },
  devIndicators: false,
  poweredByHeader: false,
  // The React Compiler memoizes components and hooks; the memoization guarantee is pinned because its default depends on the compiler version.
  reactCompiler: {
    environment: {
      enablePreserveExistingMemoizationGuarantees: true
    }
  },
  serverExternalPackages: ["@libsql/client"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [{
        key: "X-Content-Type-Options",
        value: "nosniff"
      }, {
        key: "X-Frame-Options",
        value: "DENY"
      }, {
        key: "Referrer-Policy",
        value: "no-referrer"
      }, {
        key: "Content-Security-Policy",
        value: contentSecurityPolicy
      }, {
        key: "Permissions-Policy",
        value: permissionsPolicy
      }, {
        // Browsers ignore this header on plain-HTTP responses; no includeSubDomains because self-hosted installations do not own their parent domain.
        key: "Strict-Transport-Security",
        value: "max-age=31536000"
      }, {
        key: "Cache-Control",
        value: "no-store"
      }]
    }];
  }
};

export default config;
