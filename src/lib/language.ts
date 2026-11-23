/** Interface languages with a message catalog; the first is used when the browser asks for none of them. */
export const languages = ["en", "de"] as const;

export type Language = typeof languages[number];

export const defaultLanguage: Language = "en";

/** "browser" follows the languages the browser sends with each request; otherwise one of the interface languages chosen explicitly. */
export type LanguagePreference = "browser" | Language;

/** Remembers an explicit interface language per browser; the server reads it with every request. */
export const languageCookieName = "language";

// A manual choice lasts a year and is renewed whenever it changes.
const cookieMaxAgeSeconds = 60 * 60 * 24 * 365;

export function isLanguage(value: string | null | undefined): value is Language {
  return languages.some(language => language === value);
}

/** Reads a stored preference; a missing or unknown value follows the browser. */
export function parseLanguagePreference(value: string | null | undefined): LanguagePreference {
  return isLanguage(value) ? value : "browser";
}

/** A document.cookie assignment that stores the preference. Choosing the browser default deletes the cookie. */
export function languageCookie(preference: LanguagePreference, secure: boolean) {
  const attributes = ["Path=/", "SameSite=Lax"];

  if (secure) {
    attributes.push("Secure");
  }

  if (preference === "browser") {
    return [`${languageCookieName}=`, "Max-Age=0", ...attributes].join("; ");
  }

  return [`${languageCookieName}=${preference}`, `Max-Age=${cookieMaxAgeSeconds}`, ...attributes].join("; ");
}

/** The interface language of a locale tag, such as "de" for "de-AT", or undefined when there is no catalog for it. */
export function languageOf(locale: string) {
  const base = locale.split("-")[0]?.toLowerCase();

  return isLanguage(base) ? base : undefined;
}
