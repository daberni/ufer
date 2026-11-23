import { cookies, headers } from "next/headers";
import { defaultFormatLocale, localeCookieName, parseFormatLocalePreference } from "@/lib/locale";
import { defaultLanguage, languageCookieName, parseLanguagePreference } from "@/lib/language";
import { formattableLanguages, negotiateFormatLocale, negotiateLanguage } from "./accept-language";

// Next.js has no request to read outside one, such as in the demo seed script or behavior tests.
function outsideRequest(error: unknown) {
  return error instanceof Error && error.message.includes("outside a request scope");
}

async function requestPreferences() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  return {
    format: parseFormatLocalePreference(cookieStore.get(localeCookieName)?.value),
    language: parseLanguagePreference(cookieStore.get(languageCookieName)?.value),
    acceptLanguage: headerList.get("accept-language")
  };
}

/** The interface language of the current request: the browser's stored choice, otherwise its Accept-Language header. Outside a request the default applies. */
export async function currentLanguage() {
  try {
    const preferences = await requestPreferences();

    return negotiateLanguage(preferences.language, preferences.acceptLanguage);
  } catch (error) {
    if (outsideRequest(error)) {
      return defaultLanguage;
    }

    throw error;
  }
}

/**
 * The locale for formatted values in the current request: the browser's stored preference, otherwise its Accept-Language header, kept in an explicitly chosen interface language.
 * Next.js scopes headers() and cookies() to the request being handled, so any server code can call this without the locale being passed down. Outside a request the default locale applies.
 */
export async function currentFormatLocale() {
  try {
    const preferences = await requestPreferences();
    const chosenLanguage = preferences.language === "browser" ? undefined : preferences.language;

    return negotiateFormatLocale(preferences.format, preferences.acceptLanguage, chosenLanguage);
  } catch (error) {
    if (outsideRequest(error)) {
      return defaultFormatLocale;
    }

    throw error;
  }
}

/** The request's Accept-Language languages the runtime can format, canonical, once each, in the browser's order of preference. */
export async function currentRequestLanguages() {
  try {
    const headerList = await headers();

    return formattableLanguages(headerList.get("accept-language"));
  } catch (error) {
    if (outsideRequest(error)) {
      return [];
    }

    throw error;
  }
}
