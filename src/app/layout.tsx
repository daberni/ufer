import type { Metadata, Viewport } from "next";
import { themeAttribute, themeViewport } from "@/features/appearance/theme-preference";
import { requestThemePreference } from "@/features/appearance/server/request-theme";
import { appDescription } from "@/components/branding/app-identity";
import { LocaleProvider } from "@/client/locale-provider";
import { currentFormatLocale, currentRequestLanguages } from "@/server/http/request-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ufer · Your finances, in perspective",
    template: "%s · Ufer"
  },
  description: appDescription
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
  const [preference, formatLocale, requestLanguages] = await Promise.all([requestThemePreference(), currentFormatLocale(), currentRequestLanguages()]);

  return <html lang="en" data-theme={themeAttribute(preference)}><body><LocaleProvider locale={formatLocale} requestLanguages={requestLanguages}>{children}</LocaleProvider></body></html>;
}
