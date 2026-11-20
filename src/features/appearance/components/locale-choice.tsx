"use client";

import { useId, useMemo, useState } from "react";
import { clsx } from "clsx";
import ui from "../../../components/ui/primitives.module.css";
import { useRequestLanguages } from "@/client/locale-provider";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { matchOptions } from "@/components/ui/searchable-select-behavior";
import { localeCookie, localeCookieName, parseFormatLocalePreference, type FormatLocalePreference } from "@/lib/locale";
import { browserDefaultLocale, formatLocaleExample, formatLocaleOptions } from "@/features/appearance/locale-options";
import styles from "./locale-choice.module.css";

const browserDefaultLabel = "Browser default";

const localeNoun = {
  one: "format",
  other: "formats"
};

/** Stores the preference and reloads, so the server renders every formatted value again in the new locale. */
function chooseFormatLocalePreference(preference: FormatLocalePreference) {
  document.cookie = localeCookie(preference, location.protocol === "https:");
  location.reload();
}

function storedPreference() {
  const stored = document.cookie.split("; ").find(entry => entry.startsWith(`${localeCookieName}=`));

  return parseFormatLocalePreference(stored?.slice(localeCookieName.length + 1));
}

type LocaleOption = SearchableSelectOption<FormatLocalePreference> & {
  /** Native and English names and the tag, so either language or the code finds a format. */
  searchLabel: string;
};

/** The labelled example date and amount: beside the name on wider screens, below it on phones. */
function LocaleExample({
  locale,
  placement
}: {
  locale: string;
  placement: "beside" | "below";
}) {
  const example = formatLocaleExample(locale);

  return (
    <span className={styles[placement === "beside" ? "example-beside" : "example-below"]}>
      <span>
        <span className={styles["example-label"]}>Date</span> <span className={styles["example-value"]}>{example.date}</span>
      </span>
      <span>
        <span className={styles["example-label"]}>Amount</span> <span className={styles["example-value"]}>{example.amount}</span>
      </span>
    </span>
  );
}

function localeOption(value: FormatLocalePreference, locale: string, label: string, searchLabel: string): LocaleOption {
  return {
    key: value,
    value,
    label,
    description: <LocaleExample locale={locale} placement="beside" />,
    detail: <LocaleExample locale={locale} placement="below" />,
    searchLabel
  };
}

/** Browser default previews what the request's languages select, not the explicit choice that currently applies. */
function localeOptions(preference: FormatLocalePreference, requestLanguages: readonly string[]): LocaleOption[] {
  const browserDefault = localeOption("browser", browserDefaultLocale(requestLanguages), browserDefaultLabel, browserDefaultLabel);
  const savedLocale = preference === "browser" ? undefined : preference;
  const locales = formatLocaleOptions(requestLanguages, savedLocale).map(option => localeOption(option.locale, option.locale, option.name, `${option.name} ${option.englishName} ${option.locale}`));

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
export function LocaleChoice() {
  const requestLanguages = useRequestLanguages();
  const fieldId = useId();
  // Mounted only inside the account dialog in the browser, where the cookie is readable.
  const [preference] = useState(storedPreference);
  const options = useMemo(() => localeOptions(preference, requestLanguages), [preference, requestLanguages]);
  const selected = options.find(option => option.value === preference);
  const [query, setQuery] = useState(selected?.label ?? browserDefaultLabel);

  return (
    <div className={clsx(ui["form"], styles["locale-choice"])}>
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
      <p className={ui["form-hint"]}>{"Saved in this browser; changing it reloads the page."}</p>
    </div>
  );
}
