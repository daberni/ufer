import Negotiator from "negotiator";
import { defaultFormatLocale, supportedLocale, type FormatLocalePreference } from "@/lib/locale";
import { defaultLanguage, languageOf, type Language, type LanguagePreference } from "@/lib/language";

/** The languages of an Accept-Language header from most to least preferred, parsed by Negotiator; the wildcard and refused languages (q=0) are left out. */
export function requestedLanguages(acceptLanguage: string | null | undefined) {
  const negotiator = new Negotiator({
    headers: {
      "accept-language": acceptLanguage ?? undefined
    }
  });

  return negotiator.languages().filter(language => language !== "*");
}

/** The interface language for one request: an explicit choice wins, otherwise the first requested language with a catalog, otherwise the default. */
export function negotiateLanguage(preference: LanguagePreference, acceptLanguage: string | null | undefined): Language {
  if (preference !== "browser") {
    return preference;
  }

  for (const requested of requestedLanguages(acceptLanguage)) {
    const language = languageOf(requested);

    if (language) {
      return language;
    }
  }

  return defaultLanguage;
}

/**
 * The locale for one request: an explicit preference wins, otherwise the first requested language the runtime can format, otherwise the default.
 * With an explicitly chosen interface language, the browser default only considers requested languages in that language and otherwise formats in the language itself,
 * so a German interface never shows English dates. Intl decides which languages it can format, so there is no fixed list of available locales to match against.
 */
export function negotiateFormatLocale(preference: FormatLocalePreference, acceptLanguage: string | null | undefined, chosenLanguage?: Language) {
  const candidates = preference === "browser" ? browserCandidates(acceptLanguage, chosenLanguage) : [preference];

  for (const candidate of candidates) {
    const supported = supportedLocale(candidate);

    if (supported) {
      return supported;
    }
  }

  return defaultFormatLocale;
}

function browserCandidates(acceptLanguage: string | null | undefined, chosenLanguage: Language | undefined) {
  const requested = requestedLanguages(acceptLanguage);

  if (!chosenLanguage) {
    return requested;
  }

  return [...requested.filter(language => languageOf(language) === chosenLanguage), chosenLanguage];
}

/** The requested languages the runtime can format, canonical, once each, in the browser's order of preference. */
export function formattableLanguages(acceptLanguage: string | null | undefined) {
  const locales = requestedLanguages(acceptLanguage).map(supportedLocale).filter(locale => locale !== undefined);

  return [...new Set(locales)];
}
