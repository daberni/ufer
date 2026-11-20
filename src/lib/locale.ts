/** Formats amounts, numbers and dates when the request names no language the runtime can format. */
export const defaultFormatLocale = "en";

/** Locales offered as an explicit number format; "browser" follows the languages the browser sends with each request. */
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

/** Remembers an explicit number and date format per browser; the server reads it with every request, so server and browser format alike. */
export const formatLocaleCookieName = "ufer-format-locale";

// A manual choice lasts a year and is renewed whenever it changes.
const cookieMaxAgeSeconds = 60 * 60 * 24 * 365;

/** Reads a stored preference; a missing or unknown value follows the browser. */
export function parseFormatLocalePreference(value: string | null | undefined): FormatLocalePreference {
  return formatLocaleChoices.find(choice => choice.value === value)?.value ?? "browser";
}

/** A document.cookie assignment that stores the preference. Choosing the browser default deletes the cookie. */
export function formatLocaleCookie(preference: FormatLocalePreference, secure: boolean) {
  const attributes = ["Path=/", "SameSite=Lax"];

  if (secure) {
    attributes.push("Secure");
  }

  if (preference === "browser") {
    return [`${formatLocaleCookieName}=`, "Max-Age=0", ...attributes].join("; ");
  }

  return [`${formatLocaleCookieName}=${preference}`, `Max-Age=${cookieMaxAgeSeconds}`, ...attributes].join("; ");
}

/** The languages of an Accept-Language header from most to least preferred; the wildcard and refused languages (q=0) are left out. */
export function acceptedLanguages(header: string | null | undefined) {
  const ranges = (header ?? "").split(",").map((entry, index) => {
    const [tag, ...parameters] = entry.trim().split(";");
    const quality = parameters.map(parameter => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter)?.[1]).find(value => value !== undefined);

    return {
      tag: tag.trim(),
      quality: quality === undefined ? 1 : Number(quality),
      index
    };
  });
  const accepted = ranges.filter(range => range.tag !== "" && range.tag !== "*" && range.quality > 0);

  accepted.sort((a, b) => b.quality - a.quality || a.index - b.index);

  return accepted.map(range => range.tag);
}

/** The locale for one request: an explicit preference wins, otherwise the first accepted language the runtime can format, otherwise the default. */
export function resolveFormatLocale(preference: FormatLocalePreference, acceptLanguage: string | null | undefined) {
  const candidates = preference === "browser" ? acceptedLanguages(acceptLanguage) : [preference];

  for (const candidate of candidates) {
    const supported = supportedLocale(candidate);

    if (supported) {
      return supported;
    }
  }

  return defaultFormatLocale;
}

// The formatter's resolved locale drops private-use subtags, variants and extensions it ignores, so the request-controlled header yields only the runtime's finite set of locales, which also bounds the formatter caches.
function supportedLocale(tag: string) {
  try {
    if (!Intl.NumberFormat.supportedLocalesOf(tag).length) {
      return undefined;
    }

    return new Intl.NumberFormat(tag).resolvedOptions().locale;
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
