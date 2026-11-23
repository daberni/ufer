"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

/** The manual assignments a previewed rule decides; null while no current count is known. */
export type ManualMatches = {
  count: number;
  sameCategory: number;
} | null;

/** Preselected only when every manual assignment the rule decides already has the rule's category, so the rule would not change what a person chose. */
export function adoptByDefault(matches: ManualMatches) {
  return matches !== null && matches.count > 0 && matches.sameCategory === matches.count;
}

/**
 * Whether the rule also takes over manual assignments it decides. The choice follows the preselection until a person changes it; it is only submitted while there are
 * matches.
 */
export function useManualAdoption(matches: ManualMatches) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const available = matches !== null && matches.count > 0;

  return {
    matches,
    checked: available && (chosen ?? adoptByDefault(matches)),
    setChecked: setChosen
  };
}

export function ManualAdoptionOption({
  adoption
}: {
  adoption: ReturnType<typeof useManualAdoption>;
}) {
  const t = useTranslations("categorization.adoption");
  const hintId = useId();
  const {
    matches,
    checked,
    setChecked
  } = adoption;

  if (!matches || matches.count === 0) {
    return null;
  }

  const differing = matches.count - matches.sameCategory;
  const single = matches.count === 1;
  let hint = single ? t("singleSame") : t("same");

  if (differing > 0) {
    hint = single ? t("singleDiffering") : t("differing", {
      differing
    });
  }

  return (
    <>
      <label className={ui["check-option"]}>
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={hintId}
          onChange={event => setChecked(event.target.checked)}
        />
        {t("label", {
          count: matches.count
        })}
      </label>
      <p id={hintId} className={ui["form-hint"]}>{hint}</p>
    </>
  );
}
