"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useState } from "react";
import { formatCount, formatCountLabel } from "@/lib/locale";
import { useLocale } from "@/client/locale-provider";

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
  const locale = useLocale();
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
  let hint = single ? "It already has this rule's category." : "They already have this rule's category.";

  if (differing > 0) {
    hint = single ? "It has a different category, which the rule would replace." : `${formatCount(differing, locale)} of them ${differing === 1 ? "has" : "have"} a different category, which the rule would replace.`;
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
        Also let this rule decide {formatCountLabel(matches.count, "manually categorized transaction", "manually categorized transactions", locale)}
      </label>
      <p id={hintId} className={ui["form-hint"]}>{hint} {single ? "Otherwise it stays manual." : "Otherwise they stay manual."}</p>
    </>
  );
}
