"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./type-choices.module.css";
import { Select } from "@/components/ui/select";
import { importTypes, type ImportType } from "@/features/imports/import-rows";
import type { ImportDraft } from "./use-import-draft";
import { useTranslations } from "next-intl";

/** The type column's distinct values, each mapped to a type or left to follow the amount. */
export function TypeChoices({
  draft
}: {
  draft: ImportDraft;
}) {
  const t = useTranslations("imports.typeChoices");

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-types">
      <div>
        <h2 id="import-types">{t("heading")}</h2>
        <p className={ui["form-hint"]}>{t("hint")}</p>
      </div>
      <fieldset className={styles["values"]} disabled={draft.inputsLocked}>
        <legend className={ui["visually-hidden"]}>{t("legend")}</legend>
        {draft.typeOptions.map(option => (
          <TypeRow
            key={option.key}
            label={option.label}
            hidden={draft.hiddenTypeValues.includes(option.key)}
            type={draft.typeValues[option.key] ?? null}
            onChange={type => draft.chooseType(option.key, type)}
          />
        ))}
      </fieldset>
    </section>
  );
}

function TypeRow({
  label,
  hidden,
  type,
  onChange
}: {
  label: string;
  hidden: boolean;
  type: ImportType | null;
  onChange: (type: ImportType | null) => void;
}) {
  const t = useTranslations("imports");
  const selectId = useId();

  return (
    <div className={styles["value"]}>
      {hidden ? (
        <>
          <strong className={styles["label"]}>{label}</strong>
          <p className={styles["fixed"]}>{t("typeChoices.hidden")}</p>
        </>
      ) : (
        <>
          <label htmlFor={selectId} className={styles["label"]}>
            <strong>{label}</strong>
          </label>
          <Select id={selectId} value={type ?? ""} onChange={event => onChange(event.target.value === "" ? null : event.target.value as ImportType)}>
            <option value="">{t("typeChoices.followAmount")}</option>
            {importTypes.map(value => <option key={value} value={value}>{t(`types.${value}`)}</option>)}
          </Select>
        </>
      )}
    </div>
  );
}
