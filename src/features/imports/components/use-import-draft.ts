"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { activeAccounts, useAccounts } from "@/features/accounts/queries";
import { useAreaResult } from "@/components/ui/use-area-result";
import { useCategories } from "@/features/categorization/queries";
import { useMappedImport, type MappedImportSummary } from "@/features/imports/mutations";
import { builtInTemplates, matchTemplate, templateConventions, templateMapping, templateSettings, templateTypeValues, type CsvTemplate } from "@/features/imports/csv-templates";
import { decodeCsv, detectDelimiter, parseCsv, readCsvTable } from "@/features/imports/csv-reading";
import { detectDateFormat, detectDecimal } from "@/features/imports/csv-values";
import { mapRows, typeColumnValues, type ImportType, type TypeValues } from "@/features/imports/import-rows";
import { mappingProblem, suggestMapping, type CsvMapping, type CsvSettings } from "@/features/imports/csv-mapping";
import { importIdFor } from "@/features/imports/import-batches";
import { categoryValues, importKey, prepareImport, resolveCategories, resolveTargets, sourceAccounts, templateChoices, type CategorySelection, type TargetChoice } from "@/features/imports/import-plan";
import { useImportTemplates } from "@/features/imports/template-queries";
import { decisionTotals, effectiveDecision, type DecisionInput } from "@/features/imports/reimport-decisions";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

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
  const locale = useLocale();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CsvSettings | null>(null);
  // The format detected from the file, restored when a template is switched off.
  const [detected, setDetected] = useState<CsvSettings | null>(null);
  // The template whose mapping is applied; null for a manual mapping.
  const [template, setTemplate] = useState<CsvTemplate | null>(null);
  // A matching template the person switched off is not offered as applied again for the same file.
  const [templateDismissed, setTemplateDismissed] = useState(false);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [targetChoices, setTargetChoices] = useState<Map<string, TargetChoice>>(new Map());
  const [categoryChoices, setCategoryChoices] = useState<Map<string, CategorySelection>>(new Map());
  // Type choices by lowercase type value over the template's or default type values; null keeps the type that follows the amount.
  const [typeChoices, setTypeChoices] = useState<Map<string, ImportType | null>>(new Map());
  const [checked, setChecked] = useState<{
    summary: MappedImportSummary;
    key: string;
  } | null>(null);
  const [imported, setImported] = useState<MappedImportSummary | null>(null);
  // Decisions for the checked rows' matches by line; a new check starts from the defaults again.
  const [decisions, setDecisions] = useState<Map<number, DecisionInput>>(new Map());
  const [importId, setImportId] = useState(() => crypto.randomUUID());
  const [configurationLocked, setConfigurationLocked] = useState(false);
  const latestSelection = useRef(0);
  const accounts = useAreaResult(useAccounts());
  const categories = useCategories();
  const templates = useImportTemplates();
  // Built-in templates are defined in code, so they match even before the list has loaded.
  const templateList = useMemo(() => templates.data ?? builtInTemplates, [templates.data]);
  const mutation = useMappedImport();
  // Archived accounts are not import targets.
  const accountOptions = useMemo(() => activeAccounts(accounts.data ?? []), [accounts.data]);
  const table = useMemo(() => file && settings ? readCsvTable(file.bytes, settings) : null, [file, settings]);
  // A delimiter or encoding that breaks the file keeps it loaded so another format can be chosen; nothing else works until then.
  const formatError = file && settings && !table ? "The file could not be read with these settings." : null;
  // Without a stored mapping (a new file, delimiter or encoding), the suggestion for the current header applies.
  const effectiveMapping = useMemo(() => mapping ?? (table ? suggestMapping(table.header) : null), [mapping, table]);
  const problem = effectiveMapping ? mappingProblem(effectiveMapping) : null;
  const typeValues = useMemo(() => withTypeChoices(templateTypeValues(template), typeChoices), [template, typeChoices]);
  const typeOptions = useMemo(() => table && effectiveMapping ? typeColumnValues(table.rows, effectiveMapping.type) : [], [table, effectiveMapping]);
  const mapped = useMemo(() => table && effectiveMapping && !mappingProblem(effectiveMapping) && settings ? mapRows(table.rows, effectiveMapping, settings, locale, table.lines, templateConventions(template), typeValues) : null, [table, effectiveMapping, settings, locale, template, typeValues]);
  const sources = useMemo(() => sourceAccounts(mapped?.rows ?? []), [mapped]);
  // Remembered choices follow the option lists, so a template applied before accounts or categories loaded still restores them.
  const remembered = useMemo(() => template ? templateChoices(template, accountOptions, categories.data ?? []) : null, [template, accountOptions, categories.data]);
  const resolvedTargets = useMemo(() => resolveTargets(sources.map(({ source }) => source), targetChoices, remembered?.targets ?? new Map(), accountOptions), [sources, targetChoices, remembered, accountOptions]);
  // Skipped accounts' rows neither count toward category values nor need a category choice.
  const keptRows = useMemo(() => mapped?.rows.filter(row => resolvedTargets.get(row.source)?.kind !== "skip") ?? [], [mapped, resolvedTargets]);
  const values = useMemo(() => categoryValues(keptRows, categories.data ?? []), [keptRows, categories.data]);
  const resolvedCategories = useMemo(() => resolveCategories(values, categoryChoices, remembered?.selections ?? new Map()), [values, categoryChoices, remembered]);
  const prepared = useMemo(() => mapped && settings ? prepareImport(mapped.rows, resolvedTargets, accountOptions, resolvedCategories, settings.decimal, locale) : null, [mapped, settings, resolvedTargets, accountOptions, resolvedCategories, locale]);
  const preparedKey = useMemo(() => prepared ? importKey(prepared) : null, [prepared]);
  // A refetched account list can change a preselected target; the check then no longer describes what Import would save.
  const summary = checked && checked.key === preparedKey ? checked.summary : null;
  const totals = useMemo(() => summary ? decisionTotals(summary.matches, decisions) : null, [summary, decisions]);
  const inputsLocked = configurationLocked || mutation.isPending;
  // Saved templates can arrive after the file was read; a match is then offered instead of applied silently.
  const matchingTemplate = useMemo(() => table ? matchTemplate(table.header, templateList) : null, [table, templateList]);

  // Leaving during a running request or after a confirmation started would lose the import's ID and let a new visit import differently.
  const unfinished = mutation.isPending || configurationLocked;

  useNavigationGuard(unfinished);

  function reset() {
    setSettings(null);
    setDetected(null);
    setTemplate(null);
    setTemplateDismissed(false);
    setMapping(null);
    setTargetChoices(new Map());
    setCategoryChoices(new Map());
    setTypeChoices(new Map());
    setDecisions(new Map());
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
      setFileError(`The file cannot exceed ${formatCount(25, locale)} MB.`);

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
    const detectedSettings: CsvSettings = {
      encoding: decoded.encoding,
      delimiter,
      decimal: detectDecimal([...column(suggested.amount), ...column(suggested.debit), ...column(suggested.credit)]),
      dateFormat: detectDateFormat(column(suggested.date))
    };
    const match = matchTemplate(header, templateList);

    setImportId(derivedId);
    setFile({
      name: selected.name,
      bytes
    });
    setDetected(detectedSettings);

    if (match) {
      applyTemplate(match, header, detectedSettings, true);
    } else {
      setSettings(detectedSettings);
      setMapping(suggested);
    }
  }

  /** Applies a template's format, column roles and remembered choices to the loaded file. */
  function applyTemplate(chosen: CsvTemplate, header = table?.header ?? [], base = detected, initial = false) {
    if (!base) {
      return;
    }

    setChecked(null);
    setTemplate(chosen);
    setTemplateDismissed(false);
    // On load the file has no settings yet; an offered template applies over the current encoding and delimiter.
    setSettings(templateSettings(chosen, base, initial ? null : settings));
    setMapping(templateMapping(chosen, header));
    setTargetChoices(new Map());
    setCategoryChoices(new Map());
    setTypeChoices(new Map());
  }

  /** Lets go of a deleted template: its remembered choices stay as explicit choices, so the draft keeps what it showed, and a later save creates a new template. */
  function forgetTemplate(id: string) {
    if (template?.id !== id) {
      return;
    }

    if (remembered) {
      setTargetChoices(current => new Map([...remembered.targets, ...current]));
      setCategoryChoices(current => new Map([...remembered.selections, ...current]));
    }

    const keptTypes = Object.keys({
      ...templateTypeValues(null),
      ...typeValues
    }).map(value => [value, typeValues[value] ?? null] as const);

    setTypeChoices(new Map(keptTypes));
    setTemplate(null);
  }

  /** Switches a template off: the detected number and date format and the suggested roles apply again, and its remembered choices are dropped. The current encoding and delimiter stay, since the person may have corrected them. */
  function mapManually() {
    setChecked(null);
    setTemplate(null);
    setTemplateDismissed(true);
    setSettings(current => detected ? {
      ...detected,
      encoding: current?.encoding ?? detected.encoding,
      delimiter: current?.delimiter ?? detected.delimiter
    } : current);
    setMapping(table ? suggestMapping(table.header) : null);
    setTargetChoices(new Map());
    setCategoryChoices(new Map());
    setTypeChoices(new Map());
  }

  function updateSettings(change: Partial<CsvSettings>) {
    setChecked(null);
    setSettings(current => current ? {
      ...current,
      ...change
    } : current);

    if (change.delimiter || change.encoding) {
      setMapping(null);
      setTemplate(null);
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

  /** Sets the decision for the given lines; bulk actions pass every line of one kind. */
  function decide(lines: number[], action: DecisionInput["action"], reference?: string) {
    setDecisions(current => {
      const next = new Map(current);

      for (const line of lines) {
        next.set(line, {
          line,
          action,
          ...(reference === undefined ? {} : {
            reference
          })
        });
      }

      return next;
    });
  }

  function chooseType(value: string, type: ImportType | null) {
    setChecked(null);
    setTypeChoices(current => new Map(current).set(value, type));
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

    // Possible duplicates need a decision first; pressing Import leads to the first one.
    if (confirm && totals && totals.undecided > 0) {
      revealFirstProblem();

      return;
    }

    const key = importKey(prepared);
    // Confirming sends every applied decision, so the server does exactly what the review shows.
    const applied = confirm && summary ? summary.matches.flatMap(match => {
      const decision = effectiveDecision(match, decisions.get(match.line));

      return decision ? [decision] : [];
    }) : [];

    mutation.mutate({
      importId,
      rows: prepared.rows,
      rowErrors: mapped.errors,
      targets: prepared.targets,
      categories: prepared.categories,
      decisions: applied,
      confirm,
      onConfirmStart: () => setConfigurationLocked(true)
    }, {
      onSuccess: result => {
        if (confirm) {
          setConfigurationLocked(false);
          setImported(result);
        } else {
          setDecisions(new Map());
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
    template,
    typeValues,
    typeOptions,
    hiddenTypeValues: templateConventions(template).hiddenTypes,
    chooseType,
    // A match that is not applied, because it was switched off or arrived after the file was read.
    offeredTemplate: matchingTemplate && matchingTemplate.id !== template?.id ? matchingTemplate : null,
    templateDismissed,
    templates: templateList,
    templatesStatus: templates.status,
    applyTemplate: (chosen: CsvTemplate) => applyTemplate(chosen),
    mapManually,
    forgetTemplate,
    problem,
    mapped,
    prepared,
    sources,
    targets: resolvedTargets,
    categoryValues: values,
    categories: resolvedCategories,
    keptRows,
    summary,
    totals,
    decisions,
    decide,
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

/** Type values with the person's choices applied; a null choice removes the value's type. */
function withTypeChoices(base: TypeValues, choices: Map<string, ImportType | null>): TypeValues {
  const values = {
    ...base
  };

  for (const [value, type] of choices) {
    if (type === null) {
      delete values[value];
    } else {
      values[value] = type;
    }
  }

  return values;
}
