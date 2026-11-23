"use client";

import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import styles from "./account-type-choice.module.css";
import { useId } from "react";
import { accountIcon } from "@/features/accounts/account-presentation";
import { accountTypeGroups } from "./account-type-options";
import { useAccountKindLabel } from "./use-account-kind-label";
import { useTranslations } from "next-intl";
import type { StoredAccountKind } from "../account-kinds";

type Props = {
  selected: StoredAccountKind | null;
  onSelect: (kind: StoredAccountKind) => void;
  legend?: string;
  /** Leaves out the brokerage kind, which an existing account cannot change into or out of. */
  ledgerOnly?: boolean;
};

export function AccountTypeChoice({
  selected,
  onSelect,
  legend,
  ledgerOnly = false
}: Props) {
  const t = useTranslations("accounts");
  const kindLabel = useAccountKindLabel();
  const id = useId();

  return (
    <fieldset className={styles["type-choice"]}>
      <legend className={styles["choice-legend"]}>{legend ?? t("typeChoice.legend")}</legend>
      {accountTypeGroups.map(group => (
        <fieldset className={styles["type-group"]} key={group.id}>
          <legend className={styles["group-legend"]}>
            {t(`typeGroups.${group.id}.title`)}
            <small>{t(`typeGroups.${group.id}.description`)}</small>
          </legend>
          <div className={styles["options"]}>
            {group.kinds.filter(kind => !ledgerOnly || kind !== "brokerage").map(kind => {
              const Icon = accountIcon(kind);
              const labelId = `${id}-${kind}-label`;
              const descriptionId = `${id}-${kind}-description`;

              return (
                <label className={styles["option"]} key={kind}>
                  <span className={clsx(accountStyles["account-logo"], accountStyles[kind])}>
                    <Icon size={19} aria-hidden="true" />
                  </span>
                  <span className={styles["option-text"]}>
                    <span id={labelId}>{kindLabel(kind)}</span>
                    <small id={descriptionId}>{t(`types.${kind}.description`)}</small>
                  </span>
                  <input
                    type="radio"
                    name="kind"
                    value={kind}
                    required
                    checked={selected === kind}
                    onChange={() => onSelect(kind)}
                    aria-labelledby={labelId}
                    aria-describedby={descriptionId}
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </fieldset>
  );
}
