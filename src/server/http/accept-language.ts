import Negotiator from "negotiator";
import { defaultFormatLocale, supportedLocale, type FormatLocalePreference } from "@/lib/locale";

/** The languages of an Accept-Language header from most to least preferred, parsed by Negotiator; the wildcard and refused languages (q=0) are left out. */
export function requestedLanguages(acceptLanguage: string | null | undefined) {
  const negotiator = new Negotiator({
    headers: {
      "accept-language": acceptLanguage ?? undefined
    }
  });

  return negotiator.languages().filter(language => language !== "*");
}

/**
 * The locale for one request: an explicit preference wins, otherwise the first requested language the runtime can format, otherwise the default.
 * Intl decides which languages it can format, so there is no fixed list of available locales to match against.
 */
export function negotiateFormatLocale(preference: FormatLocalePreference, acceptLanguage: string | null | undefined) {
  const candidates = preference === "browser" ? requestedLanguages(acceptLanguage) : [preference];

  for (const candidate of candidates) {
    const supported = supportedLocale(candidate);

    if (supported) {
      return supported;
    }
  }

  return defaultFormatLocale;
}

/** The requested languages the runtime can format, canonical, once each, in the browser's order of preference. */
export function formattableLanguages(acceptLanguage: string | null | undefined) {
  const locales = requestedLanguages(acceptLanguage).map(supportedLocale).filter(locale => locale !== undefined);

  return [...new Set(locales)];
}
