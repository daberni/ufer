/** Formats amounts, numbers and dates until the browser's preferred locale is known, and on the server. */
export const fallbackLocale = "en-GB";

/** Locales offered as an explicit number format; "browser" follows the browser's language list. */
export const formatLocaleChoices = [{
  value: "browser",
  label: "Browser default"
}, {
  value: "en-GB",
  label: "English (UK)"
}, {
  value: "en-US",
  label: "English (US)"
}, {
  value: "de-AT",
  label: "Deutsch (Österreich)"
}, {
  value: "de-DE",
  label: "Deutsch (Deutschland)"
}] as const;

export type FormatLocalePreference = (typeof formatLocaleChoices)[number]["value"];

/** Reads a stored preference; a missing or unknown value follows the browser. */
export function parseFormatLocalePreference(value: string | null | undefined): FormatLocalePreference {
  return formatLocaleChoices.find(choice => choice.value === value)?.value ?? "browser";
}

/** The first candidate the runtime can format, otherwise the fallback. */
export function resolveFormatLocale(preference: FormatLocalePreference, browserLanguages: readonly string[]) {
  const candidates = preference === "browser" ? browserLanguages : [preference];

  for (const candidate of candidates) {
    const supported = supportedLocale(candidate);

    if (supported) {
      return supported;
    }
  }

  return fallbackLocale;
}

function supportedLocale(tag: string) {
  try {
    return Intl.NumberFormat.supportedLocalesOf(tag)[0];
  } catch {
    return undefined;
  }
}

/** Remembers an explicit number and date format per browser; without it, formats follow the browser's languages. */
export const formatLocalePreferenceKey = "ufer-format-locale";

/** The preference stored in this browser, or "browser" when storage is unavailable. */
export function storedFormatLocalePreference(): FormatLocalePreference {
  try {
    return parseFormatLocalePreference(localStorage.getItem(formatLocalePreferenceKey));
  } catch {
    return "browser";
  }
}

// The server and the hydrating browser render format with the fallback, so their markup matches; afterwards the browser's locale provider switches to the browser's locale. Only the browser switches, so concurrent server requests never share a user's locale.
let currentLocale: string = fallbackLocale;

/** The locale every shared formatter uses. */
export function formatLocale() {
  return currentLocale;
}

/** Switches the shared formatters to another locale in the browser; the caller renders the application again. */
export function setFormatLocale(locale: string) {
  if (typeof window !== "undefined") {
    currentLocale = locale;
  }
}

/** One cached Intl formatter per locale and key, so switching the locale never reuses a formatter of the previous one. */
export function cachedFormat<T>(cache: Map<string, T>, key: string, create: (locale: string) => T) {
  const locale = formatLocale();
  const cacheKey = `${locale}|${key}`;
  let format = cache.get(cacheKey);

  if (!format) {
    format = create(locale);
    cache.set(cacheKey, format);
  }

  return format;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A whole count with grouping, for example 1,234. */
export function formatCount(value: number) {
  return cachedFormat(numberFormats, "count", locale => new Intl.NumberFormat(locale)).format(value);
}

/** Whether a ratio is shown with a minus sign; some locales write U+2212 instead of "-", and a ratio that rounds to zero has none. */
export function isNegativePercent(ratio: number) {
  return percentFormat().formatToParts(ratio).some(part => part.type === "minusSign");
}

/** A ratio as a whole percentage, for example 0.183 as "18%"; a negative ratio that rounds to zero shows "0%". */
export function formatPercent(ratio: number) {
  return percentFormat().format(ratio);
}

function percentFormat() {
  return cachedFormat(numberFormats, "percent", locale => new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "negative"
  }));
}
