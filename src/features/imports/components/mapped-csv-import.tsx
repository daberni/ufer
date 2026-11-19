"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, SearchCheck } from "lucide-react";
import styles from "./mapped-csv-import.module.css";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import { toFailure } from "@/client/api";
import { useAccounts } from "@/features/accounts/queries";
import { useMappedImport, type MappedImportSummary, type MappedTarget } from "@/features/imports/mutations";
import { dateFormats, decodeCsv, detectDateFormat, detectDecimal, detectDelimiter, mapRows, mappingProblem, parseCsv, parseCsvRecords, suggestMapping, type CsvMapping, type CsvSettings } from "@/features/imports/csv-mapping";

/** Large multi-year exports are read in the browser and sent as mapped rows in batches, so only the browser's memory bounds the file. */
const maxFileBytes = 25_000_000;

const fieldLabels: [keyof CsvMapping, string][] = [
  ["date", "Booking date"],
  ["amount", "Amount"],
  ["debit", "Debit (outflow)"],
  ["credit", "Credit (inflow)"],
  ["payee", "Payee"],
  ["description", "Description"],
  ["currency", "Currency"],
  ["category", "Category"],
  ["account", "Source account"]
];

const delimiterLabels: Record<CsvSettings["delimiter"], string> = {
  ";": "Semicolon",
  ",": "Comma",
  "\t": "Tab",
  "|": "Pipe"
};

type LoadedFile = {
  name: string;
  bytes: Uint8Array;
};

export function MappedCsvImport({
  close
}: {
  close: () => void;
}) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CsvSettings | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [targets, setTargets] = useState<Record<string, MappedTarget>>({});
  const [summary, setSummary] = useState<MappedImportSummary | null>(null);
  const [importId, setImportId] = useState(() => crypto.randomUUID());
  // Once a batch is saved, new accounts exist with the chosen name and currency; changing targets would split the import.
  const [configurationLocked, setConfigurationLocked] = useState(false);
  const latestSelection = useRef(0);
  const accounts = useAccounts();
  const mutation = useMappedImport();
  const table = useMemo(() => {
    if (!file || !settings) {
      return null;
    }

    const text = decodeCsv(file.bytes, settings.encoding).text;
    const [header, ...records] = parseCsvRecords(text, settings.delimiter);

    return {
      header: header?.cells ?? [],
      rows: records.map(record => record.cells),
      lines: records.map(record => record.line)
    };
  }, [file, settings]);
  // Without a stored mapping (a new file, delimiter or encoding), the suggestion for the current header applies.
  const effectiveMapping = useMemo(() => mapping ?? (table ? suggestMapping(table.header) : null), [mapping, table]);
  const mapped = useMemo(() => table && effectiveMapping && !mappingProblem(effectiveMapping) && settings ? mapRows(table.rows, effectiveMapping, settings, table.lines) : null, [table, effectiveMapping, settings]);
  const sources = useMemo(() => [...new Set(mapped?.rows.map(row => row.source) ?? [])].sort(), [mapped]);
  const resolvedTargets = sources.map(source => targets[source] ?? defaultTarget(source));
  // A pending check or a started confirmation fixes the whole definition: a stale check must not approve changed inputs, and a retry must reproduce the same row references and targets.
  const inputsLocked = configurationLocked || mutation.isPending;
  const targetsComplete = resolvedTargets.every(target => target.accountId !== "" && (target.accountId !== "new" || target.name.trim() !== ""));

  async function load(selected: File | undefined) {
    const selection = ++latestSelection.current;

    setSummary(null);
    setFileError(null);

    if (!selected) {
      setFile(null);

      return;
    }

    if (selected.size > maxFileBytes) {
      setFileError("The file cannot exceed 25 MB.");
      setFile(null);
      setSettings(null);
      setMapping(null);
      setTargets({});

      return;
    }

    const bytes = new Uint8Array(await selected.arrayBuffer());

    // A later selection, including a rejected one, supersedes this read.
    if (selection !== latestSelection.current) {
      return;
    }

    const decoded = decodeCsv(bytes);
    const delimiter = detectDelimiter(decoded.text);
    const [header = [], ...rows] = parseCsv(decoded.text, delimiter);
    const suggested = suggestMapping(header);
    const sample = rows.slice(0, 200);
    const column = (index: number | null) => index === null ? [] : sample.map(row => row[index] ?? "");

    setFile({
      name: selected.name,
      bytes
    });
    setSettings({
      encoding: decoded.encoding,
      delimiter,
      decimal: detectDecimal([...column(suggested.amount), ...column(suggested.debit), ...column(suggested.credit)]),
      dateFormat: detectDateFormat(column(suggested.date))
    });
    setMapping(suggested);
    setTargets({});
    setImportId(crypto.randomUUID());
    setConfigurationLocked(false);
  }

  function updateSettings(change: Partial<CsvSettings>) {
    setSummary(null);
    setSettings(current => current ? {
      ...current,
      ...change
    } : current);

    if (change.delimiter || change.encoding) {
      setMapping(null);
    }
  }

  function updateMapping(field: keyof CsvMapping, value: string) {
    setSummary(null);
    setMapping(current => ({
      ...(current ?? suggestMapping(table?.header ?? [])),
      [field]: value === "" ? null : Number(value)
    }));
  }

  function updateTarget(source: string, change: Partial<MappedTarget>) {
    setSummary(null);
    setTargets(current => ({
      ...current,
      [source]: {
        ...(current[source] ?? defaultTarget(source)),
        ...change
      }
    }));
  }

  function run(confirm: boolean) {
    if (!mapped) {
      return;
    }

    mutation.mutate({
      importId,
      rows: mapped.rows,
      rowErrors: mapped.errors,
      targets: resolvedTargets,
      confirm,
      onConfirmStart: () => setConfigurationLocked(true)
    }, {
      onSuccess: result => {
        if (confirm) {
          close();
        } else {
          setSummary(result);
        }
      }
    });
  }

  const currentMapping = effectiveMapping;
  const problem = currentMapping ? mappingProblem(currentMapping) : null;

  return (
    <div className={ui["form"]}>
      <p className={ui["form-description"]}>Import transaction history from any CSV export. Map its columns, check the result, then confirm. Nothing is saved before you confirm.</p>
      <label>
        CSV file
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          disabled={inputsLocked}
          onChange={event => void load(event.target.files?.[0])}
        />
      </label>
      {fileError && <p className={ui["error-text"]}>{fileError}</p>}
      {file && settings && table && (
        <>
          <fieldset className={styles["group"]} disabled={inputsLocked}>
            <legend>File format</legend>
            <div className={styles["grid"]}>
              <label>
                Encoding
                <Select
                  value={settings.encoding}
                  onChange={event => updateSettings({
                    encoding: event.target.value as CsvSettings["encoding"]
                  })}
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="windows-1252">Windows-1252</option>
                </Select>
              </label>
              <label>
                Delimiter
                <Select
                  value={settings.delimiter}
                  onChange={event => updateSettings({
                    delimiter: event.target.value as CsvSettings["delimiter"]
                  })}
                >
                  {Object.entries(delimiterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </label>
              <label>
                Decimal separator
                <Select
                  value={settings.decimal}
                  onChange={event => updateSettings({
                    decimal: event.target.value as CsvSettings["decimal"]
                  })}
                >
                  <option value=".">Point (1234.56)</option>
                  <option value=",">Comma (1234,56)</option>
                </Select>
              </label>
              <label>
                Date format
                <Select
                  value={settings.dateFormat}
                  onChange={event => updateSettings({
                    dateFormat: event.target.value as CsvSettings["dateFormat"]
                  })}
                >
                  {dateFormats.map(format => <option key={format} value={format}>{format}</option>)}
                </Select>
              </label>
            </div>
          </fieldset>
          <div
            className={styles["preview"]}
            role="region"
            aria-label="File preview"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>{table.header.map((column, index) => <th key={index}>{column || `Column ${index + 1}`}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 5).map((row, rowIndex) => (
                  <tr key={rowIndex}>{table.header.map((_column, index) => <td key={index}>{row[index] ?? ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={ui["form-hint"]}>{table.rows.length.toLocaleString("en")} data rows in {file.name}.</p>
          <fieldset className={styles["group"]} disabled={inputsLocked}>
            <legend>Columns</legend>
            <div className={styles["grid"]}>
              {fieldLabels.map(([field, label]) => (
                <label key={field}>
                  {label}
                  <Select value={currentMapping?.[field] ?? ""} onChange={event => updateMapping(field, event.target.value)}>
                    <option value="">Not mapped</option>
                    {table.header.map((column, index) => <option key={index} value={index}>{column || `Column ${index + 1}`}</option>)}
                  </Select>
                </label>
              ))}
            </div>
            <p className={ui["form-hint"]}>Map either Amount, or Debit and Credit. A category is used when its name matches an existing category; otherwise rules categorize the row.</p>
          </fieldset>
          {problem && <p className={ui["error-text"]}>{problem}</p>}
          {mapped && (
            <fieldset className={styles["group"]} disabled={inputsLocked}>
              <legend>Target accounts</legend>
              {resolvedTargets.map(target => (
                <div key={target.source} className={styles["target"]}>
                  <label>
                    {target.source ? `Rows from “${target.source}”` : "All rows"}
                    <Select
                      value={target.accountId}
                      disabled={inputsLocked}
                      onChange={event => updateTarget(target.source, {
                        accountId: event.target.value
                      })}
                    >
                      <option value="">Select account</option>
                      {(accounts.data ?? []).map(account => (
                        <option key={account.id} value={account.id}>
                          {account.name} ({account.currency}{account.provider === "manual" ? "" : " · bank-linked"})
                        </option>
                      ))}
                      <option value="new">New manual account …</option>
                    </Select>
                  </label>
                  {target.accountId === "new" && (
                    <div className={styles["new-account"]}>
                      <label>
                        Account name
                        <input
                          value={target.name}
                          disabled={inputsLocked}
                          maxLength={100}
                          onChange={event => updateTarget(target.source, {
                            name: event.target.value
                          })}
                        />
                      </label>
                      <label>
                        Currency
                        <input
                          value={target.currency}
                          disabled={inputsLocked}
                          maxLength={3}
                          onChange={event => updateTarget(target.source, {
                            currency: event.target.value.toUpperCase()
                          })}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
              <p className={ui["form-hint"]}>Rows imported into a bank-linked account appear in its history; its balance stays the one the bank reports.</p>
            </fieldset>
          )}
          {summary && <ImportSummary summary={summary} />}
          <FormError failure={mutation.error ? toFailure(mutation.error) : null} />
          {summary ? (
            <button
              type="button"
              className={clsx(ui["button"], ui["primary"], ui["full-width"])}
              disabled={mutation.isPending || summary.newRows === 0}
              onClick={() => run(true)}
            >
              Import {summary.newRows.toLocaleString("en")} transactions <ArrowDownToLine size={16} />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(ui["button"], ui["primary"], ui["full-width"])}
              disabled={mutation.isPending || !mapped || !targetsComplete}
              onClick={() => run(false)}
            >
              Check import <SearchCheck size={16} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ImportSummary({
  summary
}: {
  summary: MappedImportSummary;
}) {
  const alreadyImported = summary.duplicates.filter(duplicate => duplicate.reason === "already_imported").length;

  return (
    <section className={styles["summary"]} aria-label="Import check">
      <ul>
        <li><strong>{summary.newRows.toLocaleString("en")}</strong> new transactions</li>
        <li><strong>{summary.duplicates.length.toLocaleString("en")}</strong> duplicates skipped ({alreadyImported.toLocaleString("en")} imported before, {(summary.duplicates.length - alreadyImported).toLocaleString("en")} matching existing bookings within {summary.toleranceDays} days)</li>
        <li><strong>{summary.errors.length.toLocaleString("en")}</strong> rows with errors</li>
      </ul>
      {summary.errors.length > 0 && (
        <ul className={styles["errors"]}>
          {summary.errors.slice(0, 50).map(error => <li key={error.line}>Row {error.line}: {error.message}</li>)}
          {summary.errors.length > 50 && <li>… and {summary.errors.length - 50} more</li>}
        </ul>
      )}
      {summary.duplicates.length > 0 && <p className={ui["form-hint"]}>Skipped rows: {summary.duplicates.slice(0, 30).map(duplicate => duplicate.line).join(", ")}{summary.duplicates.length > 30 ? " …" : ""}</p>}
      {summary.possibleDuplicates.length > 0 && <p className={ui["form-hint"]}>Possible duplicates, imported because several existing bookings within {summary.toleranceDays} days could match: rows {summary.possibleDuplicates.slice(0, 30).join(", ")}{summary.possibleDuplicates.length > 30 ? " …" : ""}</p>}
      {summary.unknownCategories.length > 0 && <p className={ui["form-hint"]}>Unknown categories, categorized by rules instead: {summary.unknownCategories.join(", ")}</p>}
    </section>
  );
}

function defaultTarget(source: string): MappedTarget {
  return {
    source,
    accountId: "",
    name: source,
    currency: "EUR"
  };
}
