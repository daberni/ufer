import type { Metadata, Viewport } from "next";
import { themeAttribute, themeViewport } from "@/features/appearance/theme-preference";
import { requestThemePreference } from "@/features/appearance/server/request-theme";
import { FormatLocaleProvider } from "@/client/format-locale-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ufer · Your finances, in perspective",
    template: "%s · Ufer"
  },
  description: "Your personal dashboard for accounts, transactions, and net worth."
};

export async function generateViewport(): Promise<Viewport> {
  const preference = await requestThemePreference();

  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    ...themeViewport(preference)
  };
}

// Every page already renders per request, so reading the theme cookie here sends the chosen theme with the document itself: no inline script and no flash before hydration.
export default async function RootLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  const preference = await requestThemePreference();

  return <html lang="en" data-theme={themeAttribute(preference)}><body><FormatLocaleProvider>{children}</FormatLocaleProvider></body></html>;
}
