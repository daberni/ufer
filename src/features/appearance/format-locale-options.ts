import { supportedLocale } from "@/lib/locale";

// Regional formats people commonly choose; the browser's own languages are offered as well. Tags the runtime cannot format are left out.
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

/** Every candidate and browser language the runtime can format, once each, sorted by English name. */
export function formatLocaleOptions(browserLanguages: readonly string[]): FormatLocaleOption[] {
  const locales = new Set<string>();

  for (const tag of [...browserLanguages, ...candidateLocales]) {
    const locale = supportedLocale(tag);

    if (locale) {
      locales.add(locale);
    }
  }

  return [...locales]
    .map(locale => ({
      locale,
      name: displayName(locale, locale),
      englishName: displayName(locale, "en")
    }))
    .sort((left, right) => left.englishName.localeCompare(right.englishName, "en"));
}

/** An example amount and date in a locale, such as "-€1,234.56 · Nov 20, 2026". */
export function formatLocaleSample(locale: string) {
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR"
  }).format(-1234.56);
  const date = new Date(Date.UTC(2026, 10, 20)).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });

  return `${amount} · ${date}`;
}
