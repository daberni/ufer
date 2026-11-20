import { cookies, headers } from "next/headers";
import { defaultFormatLocale, formatLocaleCookieName, parseFormatLocalePreference, resolveFormatLocale } from "@/lib/locale";

/**
 * The locale for formatted values in the current request: the browser's stored preference, otherwise its Accept-Language header.
 * Next.js scopes headers() and cookies() to the request being handled, so any server code can call this without the locale being passed down.
 * Outside a request, such as the demo seed script or behavior tests, Next.js has no request to read and the default locale applies.
 */
export async function currentFormatLocale() {
  try {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    const preference = parseFormatLocalePreference(cookieStore.get(formatLocaleCookieName)?.value);

    return resolveFormatLocale(preference, headerList.get("accept-language"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("outside a request scope")) {
      return defaultFormatLocale;
    }

    throw error;
  }
}
