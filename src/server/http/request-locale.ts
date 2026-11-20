import { cookies, headers } from "next/headers";
import { formatLocaleCookieName, parseFormatLocalePreference, resolveFormatLocale } from "@/lib/locale";

/** The locale for formatted values in this request: the browser's stored preference, otherwise its Accept-Language header. */
export async function requestFormatLocale() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const preference = parseFormatLocalePreference(cookieStore.get(formatLocaleCookieName)?.value);

  return resolveFormatLocale(preference, headerList.get("accept-language"));
}
