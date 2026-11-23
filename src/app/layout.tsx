import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { themeAttribute, themeViewport } from "@/features/appearance/theme-preference";
import { requestThemePreference } from "@/features/appearance/server/request-theme";
import { LocaleProvider } from "@/client/locale-provider";
import { currentFormatLocale, currentLanguage, currentRequestLanguages } from "@/server/http/request-locale";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.metadata");

  return {
    title: {
      default: t("title"),
      template: "%s · Ufer"
    },
    description: t("description")
  };
}

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
  const [preference, language, formatLocale, requestLanguages] = await Promise.all([requestThemePreference(), currentLanguage(), currentFormatLocale(), currentRequestLanguages()]);

  // The client provider inherits the request's language and catalog from src/i18n/request.ts.
  return <html lang={language} data-theme={themeAttribute(preference)}><body><NextIntlClientProvider><LocaleProvider locale={formatLocale} requestLanguages={requestLanguages}>{children}</LocaleProvider></NextIntlClientProvider></body></html>;
}
