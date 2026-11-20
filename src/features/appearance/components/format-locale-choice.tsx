"use client";

import { useState } from "react";
import { clsx } from "clsx";
import ui from "../../../components/ui/primitives.module.css";
import { formatLocale, formatLocaleChoices, formatLocalePreferenceKey, parseFormatLocalePreference, storedFormatLocalePreference, type FormatLocalePreference } from "@/lib/locale";
import styles from "./format-locale-choice.module.css";

/** Stores the preference and reloads, so every formatted value renders again in the new locale. */
function chooseFormatLocalePreference(preference: FormatLocalePreference) {
  try {
    if (preference === "browser") {
      localStorage.removeItem(formatLocalePreferenceKey);
    } else {
      localStorage.setItem(formatLocalePreferenceKey, preference);
    }
  } catch {
    return;
  }

  location.reload();
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
  // Mounted only inside the account dialog in the browser, where storage and the browser's languages are available.
  const [preference] = useState(storedFormatLocalePreference);

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
      <p className={ui["form-hint"]}>{`For example ${sample(formatLocale())}. Saved in this browser; changing it reloads the page.`}</p>
    </div>
  );
}
