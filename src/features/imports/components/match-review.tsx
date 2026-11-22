"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useEffect, useId, useMemo, useState } from "react";
import styles from "./match-review.module.css";
import { Select } from "@/components/ui/select";
import { DateValue } from "@/components/ui/date-value";
import { allowedDecisions, decisionCandidate, effectiveDecision, type ExistingMatch, type RowDecision, type RowMatch, type SourceField } from "@/features/imports/reimport-decisions";
import type { MappedRow } from "@/features/imports/import-rows";
import { isTransactionType, transactionTypeLabels } from "@/lib/transaction-types";
import { minorUnits, money } from "@/lib/money";
import { formatCount } from "@/lib/locale";
import { useLocale } from "@/client/locale-provider";
import type { ImportDraft } from "./use-import-draft";

type Group = "changes" | "possible" | "unchanged";

// Possible duplicates come first: they wait for a decision.
const groupLabels: Record<Group, string> = {
  possible: "Possible duplicates",
  changes: "With changes",
  unchanged: "Unchanged"
};

const decisionLabels: Record<RowDecision, string> = {
  update: "Update the booking in Ufer",
  skip: "Skip this row",
  create: "Create a new booking"
};

const bulkLabels: Record<RowDecision, string> = {
  update: "Update all",
  skip: "Skip all",
  create: "Create all"
};

const pageSize = 50;

/** The check's matched rows and possible duplicates, each compared with the booking in Ufer and decided per row or in bulk. */
export function MatchReview({
  draft
}: {
  draft: ImportDraft;
}) {
  const locale = useLocale();
  const summary = draft.summary;
  const matches = useMemo(() => summary?.matches ?? [], [summary]);
  const groups = useMemo(() => groupMatches(matches), [matches]);
  const available = (Object.keys(groupLabels) as Group[]).filter(group => groups[group].length > 0);
  const [chosenGroup, setGroup] = useState<Group | null>(null);
  const [shown, setShown] = useState(pageSize);
  const group = chosenGroup && groups[chosenGroup].length > 0 ? chosenGroup : available[0];
  const [handledRequest, setHandledRequest] = useState(draft.undecidedRequest);
  const [focusTarget, setFocusTarget] = useState<{
    line: number;
    request: number;
  } | null>(null);

  // Import with undecided rows: show the possible duplicates up to the first undecided one, then focus its decision.
  if (draft.undecidedRequest !== handledRequest) {
    setHandledRequest(draft.undecidedRequest);
    const position = groups.possible.findIndex(match => effectiveDecision(match, draft.decisions.get(match.line)) === null);
    const first = groups.possible[position];

    if (first) {
      setGroup("possible");
      setShown(count => Math.max(count, Math.ceil((position + 1) / pageSize) * pageSize));
      setFocusTarget({
        line: first.line,
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
  const rows = useMemo(() => new Map((draft.prepared?.rows ?? []).map(row => [row.line, row])), [draft.prepared]);

  if (!summary || !group) {
    return null;
  }

  const listed = groups[group];
  const accountName = (row: MappedRow | undefined) => {
    const target = row ? draft.targets.get(row.source) : undefined;

    return target?.kind === "existing" ? draft.accounts.find(account => account.id === target.accountId) : undefined;
  };
  // Bulk actions apply what each row allows; a row imported before under the same reference cannot be created again.
  const bulk = (action: RowDecision) => draft.decide(listed.filter(match => allowedDecisions(match).includes(action)).map(match => match.line), action);

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-matches">
      <div>
        <h2 id="import-matches">Matches</h2>
        <p className={ui["form-hint"]}>Rows that match a booking already in Ufer update its payee, description and type from the file. Your own payee and description edits, categories, type corrections, splits and transfer links stay. Possible duplicates are only imported or used for an update once you decide.</p>
      </div>
      <div className={styles["toolbar"]}>
        <div className={ui["button-group"]} role="group" aria-label="Show">
          {available.map(item => (
            <button
              key={item}
              type="button"
              className={ui["button"]}
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
        <div className={ui["button-group"]} role="group" aria-label={`Decide for all ${groupLabels[group].toLowerCase()}`}>
          {(["update", "skip", "create"] as const).map(action => (
            <button
              key={action}
              type="button"
              className={ui["button"]}
              disabled={draft.inputsLocked || !listed.some(match => allowedDecisions(match).includes(action))}
              onClick={() => bulk(action)}
            >
              {bulkLabels[action]}
            </button>
          ))}
        </div>
      </div>
      <ol className={styles["list"]}>
        {listed.slice(0, shown).map(match => (
          <MatchItem
            key={match.line}
            match={match}
            row={rows.get(match.line)}
            account={accountName(rows.get(match.line))}
            draft={draft}
          />
        ))}
      </ol>
      {listed.length > shown && (
        <button type="button" className={clsx(ui["button"], styles["more"])} onClick={() => setShown(count => count + pageSize)}>
          Show {formatCount(Math.min(pageSize, listed.length - shown), locale)} more of {formatCount(listed.length - shown, locale)}
        </button>
      )}
    </section>
  );
}

function MatchItem({
  match,
  row,
  account,
  draft
}: {
  match: RowMatch;
  row: MappedRow | undefined;
  account: {
    name: string;
    currency: string;
  } | undefined;
  draft: ImportDraft;
}) {
  const locale = useLocale();
  const id = useId();
  // Before a decision, the person can still look at each candidate.
  const viewed = draft.viewedCandidates.get(match.line);
  const decision = effectiveDecision(match, draft.decisions.get(match.line));
  const candidate = decision?.reference ? decisionCandidate(match, decision) : match.candidates.find(option => option.reference === viewed) ?? decisionCandidate(match, decision);
  const undecided = decision === null;
  const changes = new Set<SourceField>(decision?.action === "update" ? candidate.changes : []);
  const currency = account?.currency ?? "EUR";
  const fields: [string, SourceField | null, React.ReactNode, React.ReactNode][] = [
    ["Date", null, <DateValue key="date" value={row?.date ?? null} />, <DateValue key="date" value={candidate.date} />],
    ["Amount", null, row ? fileAmount(row.amount, currency, locale) : "", money(candidate.amount, currency, locale)],
    ["Payee", "payee", row?.payee ?? "", withOverride(candidate.payee, candidate.payeeOverridden)],
    ["Description", "description", match.description, withOverride(candidate.description, candidate.descriptionOverridden)],
    ["Type", "type", row?.type ? typeLabel(row.type) : "Not stated", typeLabel(candidate.type)]
  ];

  return (
    <li className={clsx(styles["item"], undecided && styles["undecided"])} aria-labelledby={`${id}-title`} data-line={match.line}>
      <div className={styles["heading"]}>
        <h3 id={`${id}-title`}>Row {formatCount(match.line, locale)}</h3>
        <span className={ui["pill"]}>{matchLabel(match)}</span>
        {account && <span className={styles["account"]}>{account.name}</span>}
      </div>
      <table className={styles["compare"]}>
        <caption className={ui["visually-hidden"]}>Row {formatCount(match.line, locale)} compared with the booking in Ufer</caption>
        <thead>
          <tr>
            <th scope="col"><span className={ui["visually-hidden"]}>Field</span></th>
            <th scope="col">In the file</th>
            <th scope="col">In Ufer</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([label, field, file, stored]) => (
            <tr key={label} className={clsx(field && changes.has(field) && styles["changed"])}>
              <th scope="row">
                {label}
                {field && changes.has(field) && <span className={styles["change-mark"]}> · updates</span>}
              </th>
              <td>{file || "—"}</td>
              <td>{stored || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles["controls"]}>
        {match.kind === "possible" && match.candidates.length > 1 && (
          <div className={styles["control"]}>
            <label htmlFor={`${id}-candidate`}>Booking in Ufer</label>
            <Select
              id={`${id}-candidate`}
              value={candidate.reference}
              disabled={draft.inputsLocked}
              onChange={event => decision ? draft.decide([match.line], decision.action, event.target.value) : draft.viewCandidate(match.line, event.target.value)}
            >
              {match.candidates.map(option => <option key={option.reference} value={option.reference}>{candidateLabel(option, currency, locale)}</option>)}
            </Select>
          </div>
        )}
        <div className={styles["control"]}>
          <label htmlFor={`${id}-decision`}>Decision</label>
          <Select
            id={`${id}-decision`}
            value={decision?.action ?? ""}
            aria-invalid={undecided}
            aria-describedby={undecided ? `${id}-hint` : undefined}
            disabled={draft.inputsLocked}
            onChange={event => draft.decide([match.line], event.target.value as RowDecision, match.kind === "possible" ? candidate.reference : undefined)}
          >
            {undecided && <option value="" disabled>Choose …</option>}
            {allowedDecisions(match).map(action => <option key={action} value={action}>{decisionLabels[action]}</option>)}
          </Select>
          {undecided && <p id={`${id}-hint`} className={styles["hint"]}>Choose what this row does before importing.</p>}
          {decision?.action === "update" && candidate.changes.length === 0 && <p className={ui["form-hint"]}>Nothing to update: the booking already has these values.</p>}
        </div>
      </div>
    </li>
  );
}

/** Splits the matches into the review's groups; a possible duplicate stays in its group whatever is decided, so decisions never move rows away. */
function groupMatches(matches: RowMatch[]) {
  const groups: Record<Group, RowMatch[]> = {
    changes: [],
    possible: [],
    unchanged: []
  };

  for (const match of matches) {
    if (match.kind === "possible") {
      groups.possible.push(match);
    } else if (match.candidates[0]?.changes.length) {
      groups.changes.push(match);
    } else {
      groups.unchanged.push(match);
    }
  }

  return groups;
}

function matchLabel(match: RowMatch) {
  if (match.kind === "possible") {
    return match.candidates.length > 1 ? `Possible duplicate · ${match.candidates.length} candidates` : "Possible duplicate";
  }

  return match.reason === "already_imported" ? "Imported before" : "Matches a booking";
}

/** The file's amount in the account's format; an amount the server would reject never reaches the review. */
function fileAmount(value: string, currency: string, locale: string) {
  try {
    return money(minorUnits(value, currency), currency, locale);
  } catch {
    return value;
  }
}

function withOverride(value: string, overridden: boolean) {
  return overridden ? `${value || "—"} (your edit is shown instead)` : value;
}

function typeLabel(type: string) {
  return isTransactionType(type) ? transactionTypeLabels[type] : type;
}

function candidateLabel(candidate: ExistingMatch, currency: string, locale: string) {
  return [candidate.date, money(candidate.amount, currency, locale), candidate.payee || candidate.description].filter(Boolean).join(" · ");
}
