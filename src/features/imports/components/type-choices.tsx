"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./type-choices.module.css";
import { Select } from "@/components/ui/select";
import { importTypes, type ImportType } from "@/features/imports/import-rows";
import type { ImportDraft } from "./use-import-draft";

const typeLabels: Record<ImportType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer"
};

/** The type column's distinct values, each mapped to a type or left to follow the amount. */
export function TypeChoices({
  draft
}: {
  draft: ImportDraft;
}) {
  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-types">
      <div>
        <h2 id="import-types">Types</h2>
        <p className={ui["form-hint"]}>Each value of the type column imports its rows as the chosen type. An expense with a positive amount is a refund that reduces spending. Values set to follow the amount import positive amounts as income and negative ones as expenses. Rules and your corrections still change types later.</p>
      </div>
      <fieldset className={styles["values"]} disabled={draft.inputsLocked}>
        <legend className={ui["visually-hidden"]}>Type for each value</legend>
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
  const selectId = useId();

  return (
    <div className={styles["value"]}>
      {hidden ? (
        <>
          <strong className={styles["label"]}>{label}</strong>
          <p className={styles["fixed"]}>Imported hidden by the template</p>
        </>
      ) : (
        <>
          <label htmlFor={selectId} className={styles["label"]}>
            <strong>{label}</strong>
          </label>
          <Select id={selectId} value={type ?? ""} onChange={event => onChange(event.target.value === "" ? null : event.target.value as ImportType)}>
            <option value="">Follow the amount</option>
            {importTypes.map(value => <option key={value} value={value}>{typeLabels[value]}</option>)}
          </Select>
        </>
      )}
    </div>
  );
}
