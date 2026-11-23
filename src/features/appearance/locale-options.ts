import { defaultFormatLocale, supportedLocale } from "@/lib/locale";
import { languageOf, type Language } from "@/lib/language";

// Regional formats people commonly choose; the request's own languages are offered as well. Tags the runtime cannot format are left out.
const candidateLocales = [
  "af-ZA", "ar-AE", "ar-EG", "ar-SA", "bg-BG", "bn-BD", "bs-BA", "ca-ES", "cs-CZ", "cy-GB", "da-DK",
  "de-AT", "de-BE", "de-CH", "de-DE", "de-LI", "de-LU", "el-GR", "en-AU", "en-CA", "en-GB", "en-IE", "en-IN", "en-NZ", "en-SG", "en-US", "en-ZA",
  "es-AR", "es-CL", "es-CO", "es-ES", "es-MX", "es-US", "et-EE", "eu-ES", "fa-IR", "fi-FI", "fil-PH", "fr-BE", "fr-CA", "fr-CH", "fr-FR", "fr-LU",
  "ga-IE", "gl-ES", "he-IL", "hi-IN", "hr-HR", "hu-HU", "hy-AM", "id-ID", "is-IS", "it-CH", "it-IT", "ja-JP", "ka-GE", "kk-KZ", "ko-KR",
  "lb-LU", "lt-LT", "lv-LV", "mk-MK", "ms-MY", "mt-MT", "nb-NO", "nl-BE", "nl-NL", "nn-NO", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU",
  "sk-SK", "sl-SI", "sq-AL", "sr-RS", "sv-FI", "sv-SE", "sw-KE", "ta-IN", "th-TH", "tr-TR", "uk-UA", "ur-PK", "vi-VN", "zh-CN", "zh-HK", "zh-TW"
];

export type FormatLocaleOption = {
  locale: string;
  /** The locale's name in its own language, such as "Deutsch (Österreich)". */
  name: string;
  /** The name in the interface language, for searching, such as "German (Austria)". */
  englishName: string;
};

function displayName(locale: string, inLocale: string) {
  try {
    return new Intl.DisplayNames([inLocale], {
      type: "language",
      languageDisplay: "standard"
    }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/**
 * The locale "Browser default" selects: the request's first formattable language, otherwise the default. It ignores any explicit format choice,
 * but an explicitly chosen interface language limits it to that language, as on the server.
 */
export function browserDefaultLocale(requestLanguages: readonly string[], chosenLanguage?: Language) {
  if (chosenLanguage) {
    return requestLanguages.find(locale => languageOf(locale) === chosenLanguage) ?? chosenLanguage;
  }

  return requestLanguages[0] ?? defaultFormatLocale;
}

/**
 * Every candidate and request language the runtime can format, once each. The request's languages come first in the browser's order of preference;
 * the rest, including a saved choice that is neither, follow alphabetically by their own name.
 */
export function formatLocaleOptions(requestLanguages: readonly string[], savedLocale?: string): FormatLocaleOption[] {
  const preferred: string[] = [];

  for (const tag of requestLanguages) {
    const locale = supportedLocale(tag);

    if (locale && !preferred.includes(locale)) {
      preferred.push(locale);
    }
  }

  const others = new Set<string>();

  // A saved choice stays listed even when it is no longer a candidate, so the field shows what applies.
  for (const tag of savedLocale ? [savedLocale, ...candidateLocales] : candidateLocales) {
    const locale = supportedLocale(tag);

    if (locale && !preferred.includes(locale)) {
      others.add(locale);
    }
  }

  const option = (locale: string) => ({
    locale,
    name: displayName(locale, locale),
    englishName: displayName(locale, "en")
  });
  const alphabetical = [...others].map(option).sort((left, right) => left.name.localeCompare(right.name));

  return [...preferred.map(option), ...alphabetical];
}

/** An example date and amount in a locale, such as "Nov 20, 2026" and "-€1,234.56" in English. */
export function formatLocaleExample(locale: string) {
  return {
    date: new Date(Date.UTC(2026, 10, 20)).toLocaleDateString(locale, {
      calendar: "gregory",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }),
    amount: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR"
    }).format(-1234.56)
  };
}
