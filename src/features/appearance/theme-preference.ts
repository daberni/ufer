import type { Viewport } from "next";

export const themePreferences = ["system", "light", "dark"] as const;

/** System follows the operating system's color scheme; Light and Dark override it in this browser. */
export type ThemePreference = (typeof themePreferences)[number];

/** Remembers a manual theme per browser. Without it, the theme follows the operating system. */
export const themeCookieName = "ufer-theme";

// A manual choice lasts a year and is renewed whenever it changes.
const cookieMaxAgeSeconds = 60 * 60 * 24 * 365;

// The navigation color of each theme (--sidebar-bg in globals.css), which browsers use for their own interface.
const browserColors = {
  light: "#233e31",
  dark: "#172a20"
};

/** The color browsers use for their own interface while a theme is shown. */
export function browserColor(theme: "light" | "dark") {
  return browserColors[theme];
}

/** Reads a stored preference; a missing or unknown value follows the operating system. */
export function parseThemePreference(value: string | undefined): ThemePreference {
  if (value === "light" || value === "dark") {
    return value;
  }

  return "system";
}

/** The document's data-theme value, which forces a theme; absent when the operating system decides. */
export function themeAttribute(preference: ThemePreference) {
  if (preference === "system") {
    return undefined;
  }

  return preference;
}

/** A document.cookie assignment that stores the preference. Choosing System deletes the cookie. */
export function themeCookie(preference: ThemePreference, secure: boolean) {
  const attributes = ["Path=/", "SameSite=Lax"];

  if (secure) {
    attributes.push("Secure");
  }

  if (preference === "system") {
    return [`${themeCookieName}=`, "Max-Age=0", ...attributes].join("; ");
  }

  return [`${themeCookieName}=${preference}`, `Max-Age=${cookieMaxAgeSeconds}`, ...attributes].join("; ");
}

/** The color-scheme and browser interface colors for the document, so even the canvas before the stylesheet matches the theme. */
export function themeViewport(preference: ThemePreference): Pick<Viewport, "colorScheme" | "themeColor"> {
  if (preference === "system") {
    return {
      colorScheme: "light dark",
      themeColor: [{
        media: "(prefers-color-scheme: light)",
        color: browserColors.light
      }, {
        media: "(prefers-color-scheme: dark)",
        color: browserColors.dark
      }]
    };
  }

  return {
    colorScheme: preference,
    themeColor: browserColors[preference]
  };
}
