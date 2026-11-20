"use client";

import { useState } from "react";
import { clsx } from "clsx";
import ui from "../../../components/ui/primitives.module.css";
import { useFormatLocale } from "@/client/format-locale-provider";
import { formatLocaleChoices, formatLocaleCookie, formatLocaleCookieName, parseFormatLocalePreference, type FormatLocalePreference } from "@/lib/locale";
import styles from "./format-locale-choice.module.css";

/** Stores the preference and reloads, so the server renders every formatted value again in the new locale. */
function chooseFormatLocalePreference(preference: FormatLocalePreference) {
  document.cookie = formatLocaleCookie(preference, location.protocol === "https:");
  location.reload();
}

function storedPreference() {
  const stored = document.cookie.split("; ").find(entry => entry.startsWith(`${formatLocaleCookieName}=`));

  return parseFormatLocalePreference(stored?.slice(formatLocaleCookieName.length + 1));
}

function sample(locale: string) {
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

/** Browser default or one of a few locales for amounts, numbers and dates in this browser; currencies stay per account. */
export function FormatLocaleChoice() {
  const locale = useFormatLocale();
  // Mounted only inside the account dialog in the browser, where the cookie is readable.
  const [preference] = useState(storedPreference);

  return (
    <div className={clsx(ui["form"], styles["format-locale-choice"])}>
      <label>
        Number and date format
        <select value={preference} onChange={event => chooseFormatLocalePreference(parseFormatLocalePreference(event.target.value))}>
          {formatLocaleChoices.map(choice => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </select>
      </label>
      <p className={ui["form-hint"]}>{`For example ${sample(locale)}. Saved in this browser; changing it reloads the page.`}</p>
    </div>
  );
}
