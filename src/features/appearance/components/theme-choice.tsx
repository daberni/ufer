"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import ui from "../../../components/ui/primitives.module.css";
import { browserColor, parseThemePreference, themeAttribute, themeCookie, themeViewport, type ThemePreference } from "@/features/appearance/theme-preference";
import { useTranslations } from "next-intl";
import styles from "./segmented-choice.module.css";

const options = [{
  preference: "system",
  Icon: Monitor
}, {
  preference: "light",
  Icon: Sun
}, {
  preference: "dark",
  Icon: Moon
}] satisfies {
  preference: ThemePreference;
  Icon: typeof Monitor;
}[];

// The server renders the document's data-theme from the same cookie, so later requests and reloads start in the chosen theme.
function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  const attribute = themeAttribute(preference);

  if (attribute) {
    root.dataset.theme = attribute;
  } else {
    delete root.dataset.theme;
  }

  document.cookie = themeCookie(preference, location.protocol === "https:");
  applyBrowserMetadata(preference, attribute);
}

// The viewport metadata was rendered for the previous choice; browsers color their interface from it, so it follows without a reload.
function applyBrowserMetadata(preference: ThemePreference, attribute: "light" | "dark" | undefined) {
  const shownTheme = attribute ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const colorScheme = document.querySelector<HTMLMetaElement>("meta[name='color-scheme']");

  for (const meta of document.querySelectorAll<HTMLMetaElement>("meta[name='theme-color']")) {
    meta.content = browserColor(shownTheme);
    meta.removeAttribute("media");
  }

  if (colorScheme) {
    colorScheme.content = String(themeViewport(preference).colorScheme);
  }
}

/** System, Light or Dark for this browser; takes effect immediately without a reload. */
export function ThemeChoice() {
  const t = useTranslations("account.theme");
  // Mounted only inside the account dialog in the browser, where the document already carries the current choice.
  const [preference, setPreference] = useState(() => parseThemePreference(document.documentElement.dataset.theme));

  function choose(next: ThemePreference) {
    setPreference(next);
    applyThemePreference(next);
  }

  return (
    <fieldset className={styles["choice"]}>
      <legend className={styles["legend"]}>{t("legend")}</legend>
      <div className={styles["options"]}>
        {options.map(({
          preference: option,
          Icon
        }) => (
          <label className={styles["option"]} key={option}>
            <input
              className={styles["input"]}
              type="radio"
              name="theme"
              value={option}
              checked={preference === option}
              onChange={() => choose(option)}
            />
            <Icon size={16} aria-hidden="true" />
            {t(option)}
          </label>
        ))}
      </div>
      <p className={ui["form-hint"]}>{t("hint")}</p>
    </fieldset>
  );
}
