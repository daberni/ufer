"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useRef } from "react";
import { FileText, RefreshCw } from "lucide-react";
import styles from "./file-card.module.css";
import { Select } from "@/components/ui/select";
import { dateFormats, type CsvSettings } from "@/features/imports/csv-mapping";
import { rowCount } from "@/features/imports/import-plan";
import type { ImportDraft } from "./use-import-draft";
import { useLocale } from "@/client/locale-provider";

const delimiterLabels: Record<CsvSettings["delimiter"], string> = {
  ";": "Semicolon",
  ",": "Comma",
  "\t": "Tab",
  "|": "Pipe"
};

/** The loaded file with its row count, a replace action and the detected format as compact, changeable controls. */
export function FileCard({
  draft
}: {
  draft: ImportDraft;
}) {
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const {
    file,
    settings,
    table,
    inputsLocked
  } = draft;

  if (!file || !settings) {
    return null;
  }

  return (
    <div className={styles["card"]}>
      <div className={styles["file"]}>
        <FileText size={22} aria-hidden="true" />
        <div className={styles["name"]}>
          <strong>{file.name}</strong>
          {table && <span>{rowCount(table.rows.length, locale)}</span>}
        </div>
        <button
          type="button"
          className={clsx(ui["button"], ui["small"])}
          disabled={inputsLocked}
          onClick={() => input.current?.click()}
        >
          <RefreshCw size={14} />
          Replace file
        </button>
        <input
          ref={input}
          className={styles["input"]}
          type="file"
          accept=".csv,.txt,text/csv"
          tabIndex={-1}
          aria-hidden="true"
          onChange={event => {
            void draft.load(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <fieldset className={styles["format"]} disabled={inputsLocked}>
        <legend className={ui["visually-hidden"]}>File format</legend>
        <label className={styles["chip"]}>
          <span>Encoding</span>
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
          <span>Delimiter</span>
          <Select
            variant="compact"
            value={settings.delimiter}
            onChange={event => draft.updateSettings({
              delimiter: event.target.value as CsvSettings["delimiter"]
            })}
          >
            {Object.entries(delimiterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
        <label className={styles["chip"]}>
          <span>Dates</span>
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
          <span>Decimals</span>
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
    </div>
  );
}
