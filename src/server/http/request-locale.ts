import { cookies, headers } from "next/headers";
import { defaultFormatLocale, localeCookieName, parseFormatLocalePreference } from "@/lib/locale";
import { formattableLanguages, negotiateFormatLocale } from "./accept-language";

// Next.js has no request to read outside one, such as in the demo seed script or behavior tests.
function outsideRequest(error: unknown) {
  return error instanceof Error && error.message.includes("outside a request scope");
}

/**
 * The locale for formatted values in the current request: the browser's stored preference, otherwise its Accept-Language header.
 * Next.js scopes headers() and cookies() to the request being handled, so any server code can call this without the locale being passed down. Outside a request the default locale applies.
 */
export async function currentFormatLocale() {
  try {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    const preference = parseFormatLocalePreference(cookieStore.get(localeCookieName)?.value);

    return negotiateFormatLocale(preference, headerList.get("accept-language"));
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
