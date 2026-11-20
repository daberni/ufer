"use client";

import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import styles from "./account-type-choice.module.css";
import { useId } from "react";
import { accountIcon, kinds } from "@/features/accounts/account-presentation";
import { accountTypeCopy, accountTypeGroups } from "./account-type-options";
import type { AccountKind } from "../account-kinds";

type Props = {
  selected: AccountKind | null;
  onSelect: (kind: AccountKind) => void;
  legend?: string;
};

export function AccountTypeChoice({
  selected,
  onSelect,
  legend = "What do you want to add?"
}: Props) {
  const id = useId();

  return (
    <fieldset className={styles["type-choice"]}>
      <legend className={styles["choice-legend"]}>{legend}</legend>
      {accountTypeGroups.map(group => (
        <fieldset className={styles["type-group"]} key={group.id}>
          <legend className={styles["group-legend"]}>
            {group.title}
            <small>{group.description}</small>
          </legend>
          <div className={styles["options"]}>
            {group.kinds.map(kind => {
              const Icon = accountIcon(kind);
              const labelId = `${id}-${kind}-label`;
              const descriptionId = `${id}-${kind}-description`;

              return (
                <label className={styles["option"]} key={kind}>
                  <span className={clsx(accountStyles["account-logo"], accountStyles[kind])}>
                    <Icon size={19} aria-hidden="true" />
                  </span>
                  <span className={styles["option-text"]}>
                    <span id={labelId}>{kinds[kind]}</span>
                    <small id={descriptionId}>{accountTypeCopy[kind].description}</small>
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
