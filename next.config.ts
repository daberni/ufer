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

const config: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./drizzle/sqlite/**/*"]
  },
  devIndicators: false,
  poweredByHeader: false,
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
        key: "Permissions-Policy",
        value: permissionsPolicy
      }, {
        // Browsers ignore this header on plain-HTTP responses, so self-hosted installations without TLS are unaffected.
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains"
      }, {
        key: "Cache-Control",
        value: "no-store"
      }]
    }];
  }
};

export default config;
