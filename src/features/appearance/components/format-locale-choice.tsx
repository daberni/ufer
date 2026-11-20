"use client";

import { useId, useMemo, useState } from "react";
import { clsx } from "clsx";
import ui from "../../../components/ui/primitives.module.css";
import { useFormatLocale } from "@/client/format-locale-provider";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { matchOptions } from "@/components/ui/searchable-select-behavior";
import { formatLocaleCookie, formatLocaleCookieName, parseFormatLocalePreference, type FormatLocalePreference } from "@/lib/locale";
import { formatLocaleOptions, formatLocaleSample } from "@/features/appearance/format-locale-options";
import styles from "./format-locale-choice.module.css";

const browserDefaultLabel = "Browser default";

const localeNoun = {
  one: "format",
  other: "formats"
};

/** Stores the preference and reloads, so the server renders every formatted value again in the new locale. */
function chooseFormatLocalePreference(preference: FormatLocalePreference) {
  document.cookie = formatLocaleCookie(preference, location.protocol === "https:");
  location.reload();
}

function storedPreference() {
  const stored = document.cookie.split("; ").find(entry => entry.startsWith(`${formatLocaleCookieName}=`));

  return parseFormatLocalePreference(stored?.slice(formatLocaleCookieName.length + 1));
}

type LocaleOption = SearchableSelectOption<FormatLocalePreference> & {
  /** Native and English names and the tag, so either language or the code finds a format. */
  searchLabel: string;
};

function localeOptions(currentLocale: string): LocaleOption[] {
  const browserDefault: LocaleOption = {
    key: "browser",
    value: "browser",
    label: browserDefaultLabel,
    description: formatLocaleSample(currentLocale),
    searchLabel: browserDefaultLabel
  };
  const locales = formatLocaleOptions(navigator.languages).map(option => ({
    key: option.locale,
    value: option.locale,
    label: option.name,
    description: formatLocaleSample(option.locale),
    searchLabel: `${option.name} ${option.englishName} ${option.locale}`
  }));

  return [browserDefault, ...locales];
}

function matchLocales(options: readonly SearchableSelectOption<FormatLocalePreference>[], query: string) {
  const searchable = (options as readonly LocaleOption[]).map(option => ({
    option,
    label: option.searchLabel
  }));

  return matchOptions(searchable, query).map(match => match.option);
}

/** Browser default or any locale the browser can format, for amounts, numbers and dates in this browser; currencies stay per account. */
export function FormatLocaleChoice() {
  const locale = useFormatLocale();
  const fieldId = useId();
  // Mounted only inside the account dialog in the browser, where the cookie and the browser's languages are readable.
  const [preference] = useState(storedPreference);
  const options = useMemo(() => localeOptions(locale), [locale]);
  const selected = options.find(option => option.value === preference);
  const [query, setQuery] = useState(selected?.label ?? browserDefaultLabel);

  return (
    <div className={clsx(ui["form"], styles["format-locale-choice"])}>
      <div className={ui["field"]}>
        <label htmlFor={fieldId}>Number and date format</label>
        <SearchableSelect
          id={fieldId}
          options={options}
          value={selected?.value}
          onChange={chooseFormatLocalePreference}
          query={query}
          onQueryChange={setQuery}
          match={matchLocales}
          noun={localeNoun}
          placeholder="Search languages and regions"
        />
      </div>
      <p className={ui["form-hint"]}>{`For example ${formatLocaleSample(locale)}. Saved in this browser; changing it reloads the page.`}</p>
    </div>
  );
}
