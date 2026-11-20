"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccounts } from "@/features/accounts/queries";
import { useAreaResult } from "@/components/ui/use-area-result";
import { useCategories } from "@/features/categorization/queries";
import { useMappedImport, type MappedImportSummary } from "@/features/imports/mutations";
import { decodeCsv, detectDateFormat, detectDecimal, detectDelimiter, mapRows, mappingProblem, parseCsv, importIdFor, readCsvTable, suggestMapping, type CsvMapping, type CsvSettings } from "@/features/imports/csv-mapping";
import { categoryValues, defaultCategorySelection, importKey, defaultTargetChoice, prepareImport, sourceAccounts, type CategorySelection, type TargetChoice } from "@/features/imports/import-plan";

/** Large multi-year exports are read in the browser and sent as mapped rows in batches, so only the browser's memory bounds the file. */
const maxFileBytes = 25_000_000;

export type LoadedFile = {
  name: string;
  bytes: Uint8Array;
};

/**
 * The import page's state: the file and its format, the column roles, target accounts and category choices, and the check result. A check or a started confirmation fixes the whole definition: a stale check must not approve changed inputs, and a retry must reproduce the same row references and targets.
 */
export function useImportDraft() {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CsvSettings | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [targetChoices, setTargetChoices] = useState<Map<string, TargetChoice>>(new Map());
  const [categoryChoices, setCategoryChoices] = useState<Map<string, CategorySelection>>(new Map());
  const [checked, setChecked] = useState<{
    summary: MappedImportSummary;
    key: string;
  } | null>(null);
  const [imported, setImported] = useState<MappedImportSummary | null>(null);
  const [importId, setImportId] = useState(() => crypto.randomUUID());
  const [configurationLocked, setConfigurationLocked] = useState(false);
  const latestSelection = useRef(0);
  const accounts = useAreaResult(useAccounts());
  const categories = useCategories();
  const mutation = useMappedImport();
  const accountOptions = useMemo(() => accounts.data ?? [], [accounts.data]);
  const table = useMemo(() => file && settings ? readCsvTable(file.bytes, settings) : null, [file, settings]);
  // A delimiter or encoding that breaks the file keeps it loaded so another format can be chosen; nothing else works until then.
  const formatError = file && settings && !table ? "The file could not be read with these settings." : null;
  // Without a stored mapping (a new file, delimiter or encoding), the suggestion for the current header applies.
  const effectiveMapping = useMemo(() => mapping ?? (table ? suggestMapping(table.header) : null), [mapping, table]);
  const problem = effectiveMapping ? mappingProblem(effectiveMapping) : null;
  const mapped = useMemo(() => table && effectiveMapping && !mappingProblem(effectiveMapping) && settings ? mapRows(table.rows, effectiveMapping, settings, table.lines) : null, [table, effectiveMapping, settings]);
  const sources = useMemo(() => sourceAccounts(mapped?.rows ?? []), [mapped]);
  const resolvedTargets = useMemo(() => new Map(sources.map(({ source }) => [source, targetChoices.get(source) ?? defaultTargetChoice(source, accountOptions)])), [sources, targetChoices, accountOptions]);
  // Skipped accounts' rows neither count toward category values nor need a category choice.
  const keptRows = useMemo(() => mapped?.rows.filter(row => resolvedTargets.get(row.source)?.kind !== "skip") ?? [], [mapped, resolvedTargets]);
  const values = useMemo(() => categoryValues(keptRows, categories.data ?? []), [keptRows, categories.data]);
  const resolvedCategories = useMemo(() => new Map(values.map(value => [value.value, categoryChoices.get(value.value) ?? defaultCategorySelection(value)])), [values, categoryChoices]);
  const prepared = useMemo(() => mapped && settings ? prepareImport(mapped.rows, resolvedTargets, accountOptions, resolvedCategories, settings.decimal) : null, [mapped, settings, resolvedTargets, accountOptions, resolvedCategories]);
  const preparedKey = useMemo(() => prepared ? importKey(prepared) : null, [prepared]);
  // A refetched account list can change a preselected target; the check then no longer describes what Import would save.
  const summary = checked && checked.key === preparedKey ? checked.summary : null;
  const inputsLocked = configurationLocked || mutation.isPending;

  // Leaving during a running request or after a confirmation started would lose the import's ID and let a new visit import differently.
  const unfinished = mutation.isPending || configurationLocked;

  useNavigationGuard(unfinished);

  function reset() {
    setSettings(null);
    setMapping(null);
    setTargetChoices(new Map());
    setCategoryChoices(new Map());
    setImportId(crypto.randomUUID());
    setConfigurationLocked(false);
    mutation.reset();
  }

  async function load(selected: File | undefined) {
    const selection = ++latestSelection.current;

    setChecked(null);
    setFileError(null);
    // The previous file never stays visible next to a new selection, so a check cannot run on it.
    setFile(null);
    reset();

    if (!selected) {
      return;
    }

    if (selected.size > maxFileBytes) {
      setFileError("The file cannot exceed 25 MB.");

      return;
    }

    let bytes: Uint8Array;

    try {
      bytes = new Uint8Array(await selected.arrayBuffer());
    } catch {
      if (selection === latestSelection.current) {
        setFileError("The file could not be read.");
      }

      return;
    }

    // A later selection, including a rejected one, supersedes this read.
    if (selection !== latestSelection.current) {
      return;
    }

    const derivedId = await importIdFor(bytes);

    if (selection !== latestSelection.current) {
      return;
    }

    const decoded = decodeCsv(bytes);
    const delimiter = detectDelimiter(decoded.text);
    let parsed: string[][];

    try {
      parsed = parseCsv(decoded.text, delimiter);
    } catch {
      setFileError("The file could not be read as CSV.");

      return;
    }

    const [header = [], ...rows] = parsed;
    const suggested = suggestMapping(header);
    const sample = rows.slice(0, 200);
    const column = (index: number | null) => index === null ? [] : sample.map(row => row[index] ?? "");

    setImportId(derivedId);
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
  }

  function updateSettings(change: Partial<CsvSettings>) {
    setChecked(null);
    setSettings(current => current ? {
      ...current,
      ...change
    } : current);

    if (change.delimiter || change.encoding) {
      setMapping(null);
    }
  }

  /** Gives a column a role; the role leaves the column it had, and the column's previous role is cleared. */
  function assignRole(column: number, role: keyof CsvMapping | null) {
    setChecked(null);
    setMapping(current => {
      const next = {
        ...(current ?? suggestMapping(table?.header ?? []))
      };

      for (const field of Object.keys(next) as (keyof CsvMapping)[]) {
        if (next[field] === column) {
          next[field] = null;
        }
      }

      if (role) {
        next[role] = column;
      }

      return next;
    });
  }

  function chooseTarget(source: string, choice: TargetChoice) {
    setChecked(null);
    setTargetChoices(current => new Map(current).set(source, choice));
  }

  function chooseCategory(value: string, selection: CategorySelection) {
    setChecked(null);
    setCategoryChoices(current => new Map(current).set(value, selection));
  }

  /** Starts over with an empty page after an import. */
  function clear() {
    setImported(null);
    setChecked(null);
    setFile(null);
    reset();
  }

  function run(confirm: boolean) {
    if (accounts.status === "pending") {
      return;
    }

    if (!mapped || !prepared || prepared.problems.length > 0) {
      revealFirstProblem();

      return;
    }

    const key = importKey(prepared);

    mutation.mutate({
      importId,
      rows: prepared.rows,
      rowErrors: mapped.errors,
      targets: prepared.targets,
      categories: prepared.categories,
      confirm,
      onConfirmStart: () => setConfigurationLocked(true)
    }, {
      onSuccess: result => {
        if (confirm) {
          setConfigurationLocked(false);
          setImported(result);
        } else {
          setChecked({
            summary: result,
            key
          });
        }
      }
    });
  }

  return {
    file,
    fileError,
    formatError,
    settings,
    table,
    mapping: effectiveMapping,
    problem,
    mapped,
    prepared,
    sources,
    targets: resolvedTargets,
    categoryValues: values,
    categories: resolvedCategories,
    keptRows,
    summary,
    imported,
    accounts: accountOptions,
    accountsReady: accounts.status !== "pending",
    accountsFailure: accounts.status === "pending" ? accounts.failure : null,
    categoryOptions: categories.data ?? [],
    mutation,
    inputsLocked,
    load,
    updateSettings,
    assignRole,
    chooseTarget,
    chooseCategory,
    run,
    clear
  };
}

export type ImportDraft = ReturnType<typeof useImportDraft>;

/** Scrolls to the first incomplete input on the page and focuses it; every incomplete input is already marked in place. */
function revealFirstProblem() {
  const input = document.querySelector<HTMLElement>("[aria-invalid=\"true\"]");

  if (!input) {
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  input.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center"
  });
  input.focus({
    preventScroll: true
  });
}

const leaveQuestion = "The import has not finished. Leave anyway? Rows saved so far stay imported.";

const guardMarker = "uferImportGuard";

/** Asks before the page is left while `active`: on reload or closing the tab, on in-app links, and on Back/Forward, which a guard history entry on top of the page intercepts. */
function useNavigationGuard(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    const guarded = () => Boolean((window.history.state as Record<string, unknown> | null)?.[guardMarker]);
    const pushGuard = () => window.history.pushState({
      ...window.history.state,
      [guardMarker]: true
    }, "", window.location.href);

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    function linkClicked(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;

      if (!link || event.defaultPrevented) {
        return;
      }

      if (!window.confirm(leaveQuestion)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    // Back left the guard entry for the page's own entry; staying restores the guard, leaving goes one step further.
    function historyMoved() {
      if (guarded()) {
        return;
      }

      if (window.confirm(leaveQuestion)) {
        window.removeEventListener("popstate", historyMoved);
        window.history.back();
      } else {
        pushGuard();
      }
    }

    if (!guarded()) {
      pushGuard();
    }

    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", historyMoved);
    document.addEventListener("click", linkClicked, true);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", historyMoved);
      document.removeEventListener("click", linkClicked, true);

      // When the import ends on this page, the guard entry goes, so Back works in one step again.
      if (guarded()) {
        window.history.back();
      }
    };
  }, [active]);
}
