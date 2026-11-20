/** Formats amounts, numbers and dates when the request names no language the runtime can format. */
export const defaultFormatLocale = "en";

/** "browser" follows the languages the browser sends with each request; any other value is a locale tag chosen explicitly. */
export type FormatLocalePreference = "browser" | (string & {});

/** Remembers an explicit number and date format per browser; the server reads it with every request, so server and browser format alike. */
export const localeCookieName = "locale";

// A manual choice lasts a year and is renewed whenever it changes.
const cookieMaxAgeSeconds = 60 * 60 * 24 * 365;

/** Reads a stored preference; a missing value or a tag the runtime cannot format follows the browser. */
export function parseFormatLocalePreference(value: string | null | undefined): FormatLocalePreference {
  if (!value || value === "browser") {
    return "browser";
  }

  return supportedLocale(value) ?? "browser";
}

/** A document.cookie assignment that stores the preference. Choosing the browser default deletes the cookie. */
export function localeCookie(preference: FormatLocalePreference, secure: boolean) {
  const attributes = ["Path=/", "SameSite=Lax"];

  if (secure) {
    attributes.push("Secure");
  }

  if (preference === "browser") {
    return [`${localeCookieName}=`, "Max-Age=0", ...attributes].join("; ");
  }

  return [`${localeCookieName}=${preference}`, `Max-Age=${cookieMaxAgeSeconds}`, ...attributes].join("; ");
}

/**
 * The runtime's canonical locale for a tag, or undefined when it cannot format it. Only the base language/region and the hour cycle (hc) and numbering system (nu)
 * extensions survive (dates are always Gregorian), and only with values Intl actually applies; private-use subtags, variants and other extensions are dropped. Request-controlled tags
 * therefore yield a finite set of locales, which also bounds the formatter caches.
 */
export function supportedLocale(tag: string) {
  try {
    if (!Intl.NumberFormat.supportedLocalesOf(tag).length) {
      return undefined;
    }

    const requested = new Intl.Locale(tag);
    const base = new Intl.Locale(new Intl.NumberFormat(tag).resolvedOptions().locale).baseName;
    const hourCycle = requested.hourCycle && new Intl.DateTimeFormat(`${base}-u-hc-${requested.hourCycle}`, {
      timeStyle: "short"
    }).resolvedOptions().hourCycle === requested.hourCycle ? requested.hourCycle : undefined;
    const numberingSystem = requested.numberingSystem && new Intl.NumberFormat(`${base}-u-nu-${requested.numberingSystem}`).resolvedOptions().numberingSystem === requested.numberingSystem ? requested.numberingSystem : undefined;

    return new Intl.Locale(base, {
      hourCycle,
      numberingSystem
    }).toString();
  } catch {
    return undefined;
  }
}

/** One cached Intl formatter per locale and key. */
export function cachedFormat<T>(cache: Map<string, T>, locale: string, key: string, create: (locale: string) => T) {
  const cacheKey = `${locale}|${key}`;
  let format = cache.get(cacheKey);

  if (!format) {
    format = create(locale);
    cache.set(cacheKey, format);
  }

  return format;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A whole count with grouping, for example 1,234 in English. */
export function formatCount(value: number, locale: string) {
  return cachedFormat(numberFormats, locale, "count", supported => new Intl.NumberFormat(supported)).format(value);
}

/** Whether a ratio is shown with a minus sign; some locales write U+2212 instead of "-", and a ratio that rounds to zero has none. */
export function isNegativePercent(ratio: number, locale: string) {
  return percentFormat(locale).formatToParts(ratio).some(part => part.type === "minusSign");
}

/** A ratio as a whole percentage, for example 0.183 as "18%" in English; a negative ratio that rounds to zero shows "0%". */
export function formatPercent(ratio: number, locale: string) {
  return percentFormat(locale).format(ratio);
}

function percentFormat(locale: string) {
  return cachedFormat(numberFormats, locale, "percent", supported => new Intl.NumberFormat(supported, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "negative"
  }));
}
