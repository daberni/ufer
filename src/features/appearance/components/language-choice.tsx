"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ui from "../../../components/ui/primitives.module.css";
import { languageCookie, languageCookieName, parseLanguagePreference, type LanguagePreference } from "@/lib/language";
import styles from "./segmented-choice.module.css";

// Each language is named in itself, so someone who cannot read the current language still finds their own.
const options = [{
  preference: "browser"
}, {
  preference: "en",
  name: "English"
}, {
  preference: "de",
  name: "Deutsch"
}] satisfies {
  preference: LanguagePreference;
  name?: string;
}[];

/** Stores the preference and reloads, so the server renders every view again in the new language. */
function chooseLanguage(preference: LanguagePreference) {
  document.cookie = languageCookie(preference, location.protocol === "https:");
  location.reload();
}

function storedPreference() {
  const stored = document.cookie.split("; ").find(entry => entry.startsWith(`${languageCookieName}=`));

  return parseLanguagePreference(stored?.slice(languageCookieName.length + 1));
}

/** Browser default, English or German for this browser's interface. */
export function LanguageChoice() {
  const t = useTranslations("account.language");
  // Mounted only inside the account dialog in the browser, where the cookie is readable.
  const [preference] = useState(storedPreference);

  return (
    <fieldset className={styles["choice"]}>
      <legend className={styles["legend"]}>{t("legend")}</legend>
      <div className={styles["options"]}>
        {options.map(option => (
          <label className={styles["option"]} key={option.preference}>
            <input
              className={styles["input"]}
              type="radio"
              name="language"
              value={option.preference}
              checked={preference === option.preference}
              onChange={() => chooseLanguage(option.preference)}
            />
            {"name" in option ? <span lang={option.preference}>{option.name}</span> : t("browser")}
          </label>
        ))}
      </div>
      <p className={ui["form-hint"]}>{t("hint")}</p>
    </fieldset>
  );
}
