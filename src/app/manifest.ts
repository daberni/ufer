import type { MetadataRoute } from "next";
import { appDescription, appName } from "@/components/branding/app-identity";
import { browserColor } from "@/features/appearance/theme-preference";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: appDescription,
    start_url: "/",
    scope: "/",
    display: "standalone",
    // A manifest cannot vary by color scheme, so the splash screen uses the brand color of the browser bars instead of a light page background that flashes in dark mode.
    background_color: browserColor("light"),
    theme_color: browserColor("light"),
    lang: "en",
    dir: "ltr",
    categories: ["finance"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
