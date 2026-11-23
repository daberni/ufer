"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useRef } from "react";
import { FileText, RefreshCw } from "lucide-react";
import styles from "./file-card.module.css";
import { Select } from "@/components/ui/select";
import { dateFormats } from "@/features/imports/csv-values";
import type { CsvSettings } from "@/features/imports/csv-mapping";
import { statementFormatLabels } from "@/features/imports/statement-files";
import { importFileTypes } from "@/features/imports/pending-import-file";
import type { ImportDraft } from "./use-import-draft";
import { useTranslations } from "next-intl";

const delimiterNames: Record<CsvSettings["delimiter"], "semicolon" | "comma" | "tab" | "pipe"> = {
  ";": "semicolon",
  ",": "comma",
  "\t": "tab",
  "|": "pipe"
};

/** The loaded file with its row count, a replace action and the detected format as compact, changeable controls. */
export function FileCard({
  draft
}: {
  draft: ImportDraft;
}) {
  const t = useTranslations("imports");
  const input = useRef<HTMLInputElement>(null);
  const {
    file,
    settings,
    statement,
    table,
    inputsLocked
  } = draft;

  if (!file || (!settings && !statement)) {
    return null;
  }

  const rows = statement ? statement.rows.length + statement.errors.length : table?.rows.length;

  return (
    <div className={styles["card"]}>
      <div className={styles["file"]}>
        <FileText size={22} aria-hidden="true" />
        <div className={styles["name"]}>
          <strong>{file.name}</strong>
          {rows !== undefined && (
            <span>
              {statement ? t("file.statementRows", {
                format: statementFormatLabels[statement.format],
                count: rows
              }) : t("rowCount", {
                count: rows
              })}
            </span>
          )}
        </div>
        <button
          type="button"
          className={clsx(ui["button"], ui["small"])}
          disabled={inputsLocked}
          onClick={() => input.current?.click()}
        >
          <RefreshCw size={14} />
          {t("file.replace")}
        </button>
        <input
          ref={input}
          className={styles["input"]}
          type="file"
          accept={importFileTypes}
          tabIndex={-1}
          aria-hidden="true"
          onChange={event => {
            void draft.load(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {settings && (
        <fieldset className={styles["format"]} disabled={inputsLocked}>
          <legend className={ui["visually-hidden"]}>{t("file.format")}</legend>
          <label className={styles["chip"]}>
            <span>{t("file.encoding")}</span>
            <Select
              variant="compact"
              value={settings.encoding}
              onChange={event => draft.updateSettings({
                encoding: event.target.value as CsvSettings["encoding"]
              })}
            >
              <option value="utf-8">UTF-8</option>
              <option value="windows-1252">Windows-1252</option>
            </Select>
          </label>
          <label className={styles["chip"]}>
            <span>{t("file.delimiter")}</span>
            <Select
              variant="compact"
              value={settings.delimiter}
              onChange={event => draft.updateSettings({
                delimiter: event.target.value as CsvSettings["delimiter"]
              })}
            >
              {Object.entries(delimiterNames).map(([value, name]) => <option key={value} value={value}>{t(`file.delimiters.${name}`)}</option>)}
            </Select>
          </label>
          <label className={styles["chip"]}>
            <span>{t("file.dates")}</span>
            <Select
              variant="compact"
              value={settings.dateFormat}
              onChange={event => draft.updateSettings({
                dateFormat: event.target.value as CsvSettings["dateFormat"]
              })}
            >
              {dateFormats.map(format => <option key={format} value={format}>{format}</option>)}
            </Select>
          </label>
          <label className={styles["chip"]}>
            <span>{t("file.decimals")}</span>
            <Select
              variant="compact"
              value={settings.decimal}
              onChange={event => draft.updateSettings({
                decimal: event.target.value as CsvSettings["decimal"]
              })}
            >
              <option value=".">1,234.56</option>
              <option value=",">1.234,56</option>
            </Select>
          </label>
        </fieldset>
      )}
    </div>
  );
}
