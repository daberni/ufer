"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import styles from "./match-review.module.css";
import { Select } from "@/components/ui/select";
import { DateValue } from "@/components/ui/date-value";
import { allowedDecisions, decisionCandidate, effectiveDecision, type ExistingMatch, type RowDecision, type RowMatch, type SourceField } from "@/features/imports/reimport-decisions";
import type { MappedRow, RowError } from "@/features/imports/import-rows";
import { isTransactionType, transactionTypeLabels } from "@/lib/transaction-types";
import { minorUnits, money } from "@/lib/money";
import { formatCount } from "@/lib/locale";
import { useLocale } from "@/client/locale-provider";
import type { ImportDraft } from "./use-import-draft";

type Group = "undecided" | "updates" | "new" | "errors";

// Possible duplicates come first: they block the import. Matches that would change nothing are a no-op and not listed.
const groupLabels: Record<Group, string> = {
  undecided: "Possible duplicates",
  updates: "Updates",
  new: "New",
  errors: "Errors"
};

const decisionLabels: Record<RowDecision, string> = {
  update: "Update",
  skip: "Skip",
  create: "Create new"
};

const bulkLabels: Record<RowDecision, string> = {
  update: "Update all",
  skip: "Skip all",
  create: "Create all"
};

const pageSize = 100;

type Account = {
  name: string;
  currency: string;
};

/** The checked rows as one compact table per group: possible duplicates and updates with a decision each, new rows and errors for reference. */
export function MatchReview({
  draft
}: {
  draft: ImportDraft;
}) {
  const locale = useLocale();
  const summary = draft.summary;
  const rows = useMemo(() => new Map((draft.prepared?.rows ?? []).map(row => [row.line, row])), [draft.prepared]);
  const groups = useMemo(() => groupRows(summary, rows), [summary, rows]);
  const available = (Object.keys(groupLabels) as Group[]).filter(group => groups[group].length > 0);
  const [chosenGroup, setGroup] = useState<Group | null>(null);
  const [shown, setShown] = useState(pageSize);
  const group = chosenGroup && groups[chosenGroup].length > 0 ? chosenGroup : available[0];
  const [handledRequest, setHandledRequest] = useState(draft.undecidedRequest);
  const [focusTarget, setFocusTarget] = useState<{
    line: number;
    request: number;
  } | null>(null);

  // Import with undecided rows: show the possible duplicates up to the first blocked one, then focus its decision.
  if (draft.undecidedRequest !== handledRequest) {
    setHandledRequest(draft.undecidedRequest);
    const position = groups.undecided.findIndex(line => draft.totals?.blocked.has(line));

    if (position >= 0) {
      setGroup("undecided");
      setShown(count => Math.max(count, Math.ceil((position + 1) / pageSize) * pageSize));
      setFocusTarget({
        line: groups.undecided[position],
        request: draft.undecidedRequest
      });
    }
  }

  useEffect(() => {
    if (!focusTarget) {
      return;
    }

    const select = document.querySelector<HTMLElement>(`[data-line="${focusTarget.line}"] select[aria-invalid="true"]`);

    select?.scrollIntoView({
      block: "center"
    });
    select?.focus({
      preventScroll: true
    });
  }, [focusTarget]);

  if (!summary || !group) {
    return null;
  }

  const matchOf = new Map(summary.matches.map(match => [match.line, match]));
  const errorOf = new Map(summary.errors.map(error => [error.line, error]));
  const listed = groups[group];
  const decidable = group === "undecided" || group === "updates";
  const listedMatches = listed.flatMap(line => matchOf.get(line) ?? []);
  const accountOf = (row: MappedRow | undefined): Account | undefined => {
    const target = row ? draft.targets.get(row.source) : undefined;

    return target?.kind === "existing" ? draft.accounts.find(account => account.id === target.accountId) : undefined;
  };
  // Bulk actions apply what each row allows; a row imported before under the same reference cannot be created again.
  const bulk = (action: RowDecision) => draft.decide(listedMatches.filter(match => allowedDecisions(match).includes(action)).map(match => match.line), action);
  const unchanged = draft.totals?.unchanged ?? 0;

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-matches">
      <div>
        <h2 id="import-matches">Rows</h2>
        <p className={ui["form-hint"]}>Updates write the file's payee, description and type to the booking in Ufer; your own edits, categories, type corrections, splits and links stay. Possible duplicates need a decision.{unchanged > 0 ? ` ${formatCount(unchanged, locale)} matched ${unchanged === 1 ? "row changes" : "rows change"} nothing and ${unchanged === 1 ? "is" : "are"} not listed.` : ""}</p>
      </div>
      <div className={styles["toolbar"]}>
        <div className={ui["button-group"]} role="group" aria-label="Show">
          {available.map(item => (
            <button
              key={item}
              type="button"
              className={clsx(ui["button"], item === "undecided" && (draft.totals?.blocked.size ?? 0) > 0 && styles["attention"])}
              aria-pressed={item === group}
              onClick={() => {
                setGroup(item);
                setShown(pageSize);
              }}
            >
              {groupLabels[item]} ({formatCount(groups[item].length, locale)})
            </button>
          ))}
        </div>
        {decidable && (
          <div className={ui["button-group"]} role="group" aria-label={`Decide for all ${groupLabels[group].toLowerCase()}`}>
            {(["update", "skip", "create"] as const).map(action => (
              <button
                key={action}
                type="button"
                className={ui["button"]}
                disabled={draft.inputsLocked || !listedMatches.some(match => allowedDecisions(match).includes(action))}
                onClick={() => bulk(action)}
              >
                {bulkLabels[action]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className={styles["table"]}
        role="region"
        aria-labelledby="import-matches"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Row</th>
              {decidable && <th scope="col">Decision</th>}
              <th scope="col">Date</th>
              <th scope="col" className={styles["amount"]}>Amount</th>
              <th scope="col">Payee</th>
              <th scope="col">Description</th>
              {group === "errors" ? <th scope="col">Problem</th> : <th scope="col">Type</th>}
            </tr>
          </thead>
          <tbody>
            {listed.slice(0, shown).map(line => {
              const row = rows.get(line);
              const match = matchOf.get(line);

              if (match) {
                return (
                  <MatchRows
                    key={line}
                    match={match}
                    row={row}
                    account={accountOf(row)}
                    draft={draft}
                  />
                );
              }

              return (
                <PlainRow
                  key={line}
                  line={line}
                  row={row}
                  account={accountOf(row)}
                  error={errorOf.get(line)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {listed.length > shown && (
        <button type="button" className={clsx(ui["button"], styles["more"])} onClick={() => setShown(count => count + pageSize)}>
          Show {formatCount(Math.min(pageSize, listed.length - shown), locale)} more of {formatCount(listed.length - shown, locale)}
        </button>
      )}
    </section>
  );
}

/** A new row or a row error: the file's values, without a decision. */
function PlainRow({
  line,
  row,
  account,
  error
}: {
  line: number;
  row: MappedRow | undefined;
  account: Account | undefined;
  error: RowError | undefined;
}) {
  const locale = useLocale();
  const currency = account?.currency ?? row?.currency ?? "EUR";

  return (
    <tr>
      <td className={styles["line"]}>{formatCount(line, locale)}</td>
      <td className={styles["nowrap"]}><DateValue value={row?.date ?? null} /></td>
      <td className={styles["amount"]}>{row ? fileAmount(row.amount, currency, locale) : "—"}</td>
      <td>{row?.payee || "—"}</td>
      <td>{row?.description || "—"}</td>
      {error ? <td className={styles["problem"]}>{error.message}</td> : <td>{row?.type ? typeLabel(row.type) : "—"}</td>}
    </tr>
  );
}

/** A matched or possibly duplicate row: the file's values with changed fields shown as old → new, and for a possible duplicate the booking in Ufer below it. */
function MatchRows({
  match,
  row,
  account,
  draft
}: {
  match: RowMatch;
  row: MappedRow | undefined;
  account: Account | undefined;
  draft: ImportDraft;
}) {
  const locale = useLocale();
  const viewed = draft.viewedCandidates.get(match.line);
  const decision = effectiveDecision(match, draft.decisions.get(match.line));
  const candidate = decision?.booking ? decisionCandidate(match, decision) : match.candidates.find(option => option.id === viewed) ?? decisionCandidate(match, decision);
  const conflict = draft.totals?.conflicts.has(match.line) ?? false;
  const blocked = decision === null || conflict;
  const changes = new Set<SourceField>(decision?.action === "update" ? candidate.changes : []);
  const currency = account?.currency ?? "EUR";
  const possible = match.kind === "possible";
  const label = `row ${formatCount(match.line, locale)}`;
  // A file without a type keeps the booking's type.
  const fileType = row?.type ? typeLabel(row.type) : typeLabel(candidate.type);
  const field = (name: SourceField, file: string, stored: string, override: string | null): ReactNode => changes.has(name) ? (
    <span className={styles["change"]}>
      <del>{override ?? (stored || "—")}</del>
      <span aria-hidden="true"> → </span>
      <ins>{file || "—"}</ins>
      {override !== null && <span className={styles["note"]}> (your edit stays shown)</span>}
    </span>
  ) : file || "—";

  return (
    <Fragment>
      <tr data-line={match.line} className={clsx(possible && styles["main"], blocked && styles["blocked"])}>
        <td className={styles["line"]}>{formatCount(match.line, locale)}</td>
        <td className={styles["decision"]}>
          <Select
            variant="compact"
            aria-label={`Decision for ${label}`}
            value={decision?.action ?? ""}
            aria-invalid={blocked}
            title={conflict ? "Another row already updates this booking. Choose another booking or decision." : undefined}
            disabled={draft.inputsLocked}
            onChange={event => draft.decide([match.line], event.target.value as RowDecision, possible ? candidate.id : undefined)}
          >
            {decision === null && <option value="" disabled>Choose …</option>}
            {allowedDecisions(match).map(action => <option key={action} value={action}>{decisionLabels[action]}</option>)}
          </Select>
        </td>
        <td className={styles["nowrap"]}><DateValue value={row?.date ?? null} /></td>
        <td className={styles["amount"]}>{row ? fileAmount(row.amount, currency, locale) : "—"}</td>
        <td>{field("payee", row?.payee ?? "", candidate.payee, candidate.payeeOverride)}</td>
        <td>{field("description", match.description, candidate.description, candidate.descriptionOverride)}</td>
        <td className={styles["nowrap"]}>{field("type", fileType, typeLabel(candidate.type), null)}</td>
      </tr>
      {possible && (
        <tr className={clsx(styles["existing"], blocked && styles["blocked"])}>
          <td className={styles["line"]}><span className={ui["visually-hidden"]}>Booking in Ufer for {label}</span></td>
          <td className={styles["decision"]}>
            {match.candidates.length > 1 ? (
              <Select
                variant="compact"
                aria-label={`Booking in Ufer for ${label}`}
                value={candidate.id}
                disabled={draft.inputsLocked}
                onChange={event => decision ? draft.decide([match.line], decision.action, event.target.value) : draft.viewCandidate(match.line, event.target.value)}
              >
                {match.candidates.map((option, position) => <option key={option.id} value={option.id}>{candidateLabel(option, position, match.candidates.length, currency, locale)}</option>)}
              </Select>
            ) : <span className={styles["note"]}>In Ufer</span>}
            {conflict && <span className={styles["warning"]}>Another row updates this booking.</span>}
          </td>
          <td className={styles["nowrap"]}><DateValue value={candidate.date} /></td>
          <td className={styles["amount"]}>{money(candidate.amount, currency, locale)}</td>
          <td>{candidate.payeeOverride ?? (candidate.payee || "—")}</td>
          <td>{candidate.descriptionOverride ?? (candidate.description || "—")}</td>
          <td className={styles["nowrap"]}>{typeLabel(candidate.type)}</td>
        </tr>
      )}
    </Fragment>
  );
}

/** Lines per group in file order: possible duplicates, matches whose update changes something, new rows and errors. */
function groupRows(summary: ImportDraft["summary"], rows: ReadonlyMap<number, MappedRow>) {
  const groups: Record<Group, number[]> = {
    undecided: [],
    updates: [],
    new: [],
    errors: []
  };

  if (!summary) {
    return groups;
  }

  const matched = new Set(summary.matches.map(match => match.line));
  const failed = new Set(summary.errors.map(error => error.line));

  for (const match of summary.matches) {
    if (match.kind === "possible") {
      groups.undecided.push(match.line);
    } else if (match.candidates[0]?.changes.length) {
      groups.updates.push(match.line);
    }
  }

  for (const line of rows.keys()) {
    if (!matched.has(line) && !failed.has(line)) {
      groups.new.push(line);
    }
  }

  groups.new.sort((left, right) => left - right);
  groups.errors = [...failed].sort((left, right) => left - right);

  return groups;
}

/** The file's amount in the account's format; an amount the server would reject never reaches the review. */
function fileAmount(value: string, currency: string, locale: string) {
  try {
    return money(minorUnits(value, currency), currency, locale);
  } catch {
    return value;
  }
}

function typeLabel(type: string) {
  return isTransactionType(type) ? transactionTypeLabels[type] : type;
}

/** Numbered, so candidates whose shown texts are equal stay distinguishable; the row below the file's row shows the chosen one. */
function candidateLabel(candidate: ExistingMatch, position: number, count: number, currency: string, locale: string) {
  return [`${position + 1} of ${count}`, candidate.date, money(candidate.amount, currency, locale), candidate.payeeOverride || candidate.payee || candidate.description].filter(Boolean).join(" · ");
}
