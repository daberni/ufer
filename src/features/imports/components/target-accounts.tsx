"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./target-accounts.module.css";
import { Select } from "@/components/ui/select";
import { newAccountChoice, rowCount, type TargetChoice } from "@/features/imports/import-plan";
import type { Account } from "@/features/accounts/types";
import type { ImportDraft } from "./use-import-draft";

/** One account picker for the whole file, or one per value of the mapped account column. */
export function TargetAccounts({
  draft
}: {
  draft: ImportDraft;
}) {
  const perSource = draft.mapping?.account !== null && draft.mapping?.account !== undefined;
  // Without an account column, the single picker shows before the columns are complete.
  const sources = perSource || draft.sources.length > 0 ? draft.sources : [{
    source: "",
    rows: draft.table?.rows.length ?? 0
  }];

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-accounts">
      <h2 id="import-accounts">{perSource ? "Accounts in the file" : "Import into"}</h2>
      {perSource && <p className={ui["form-hint"]}>Each account value in the file goes to an existing account, a new manual account, or is skipped.</p>}
      {perSource && !draft.mapped && <p className={ui["form-hint"]}>Choose the date, amount and payee or description columns below to see the accounts.</p>}
      <fieldset className={styles["targets"]} disabled={draft.inputsLocked}>
        <legend className={ui["visually-hidden"]}>Target accounts</legend>
        {sources.map(({
          source,
          rows
        }) => (
          <TargetRow
            key={source}
            source={source}
            rows={rows}
            perSource={perSource}
            choice={draft.targets.get(source) ?? {
              kind: "unset"
            }}
            accounts={draft.accounts}
            onChange={choice => draft.chooseTarget(source, choice)}
          />
        ))}
      </fieldset>
      {draft.targets.size > 0 && [...draft.targets.values()].some(choice => choice.kind === "existing" && draft.accounts.find(account => account.id === choice.accountId)?.provider !== "manual") && <p className={ui["form-hint"]}>Rows imported into a bank-linked account appear in its history; its balance stays the one the bank reports.</p>}
    </section>
  );
}

function TargetRow({
  source,
  rows,
  perSource,
  choice,
  accounts,
  onChange
}: {
  source: string;
  rows: number;
  perSource: boolean;
  choice: TargetChoice;
  accounts: Account[];
  onChange: (choice: TargetChoice) => void;
}) {
  const selectId = useId();
  const manual = accounts.filter(account => account.provider === "manual");
  const linked = accounts.filter(account => account.provider !== "manual");
  let value = "";

  if (choice.kind === "existing") {
    value = choice.accountId;
  } else if (choice.kind === "new" || choice.kind === "skip") {
    value = choice.kind;
  }

  function select(next: string) {
    if (next === "new") {
      onChange(newAccountChoice(source));
    } else if (next === "skip") {
      onChange({
        kind: "skip"
      });
    } else if (next === "") {
      onChange({
        kind: "unset"
      });
    } else {
      onChange({
        kind: "existing",
        accountId: next
      });
    }
  }

  return (
    <div className={clsx(styles["target"], perSource && styles["listed"])}>
      <div className={styles["choice"]}>
        {perSource ? (
          <label htmlFor={selectId} className={styles["source"]}>
            <strong>{source || "No account value"}</strong>
            <span>{rowCount(rows)}</span>
          </label>
        ) : (
          <label htmlFor={selectId} className={ui["visually-hidden"]}>Target account</label>
        )}
        <Select id={selectId} value={value} onChange={event => select(event.target.value)}>
          <option value="">Choose an account</option>
          {manual.length > 0 && (
            <optgroup label="Manual accounts">
              {manual.map(account => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}
            </optgroup>
          )}
          {linked.length > 0 && (
            <optgroup label="Bank-linked accounts">
              {linked.map(account => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}
            </optgroup>
          )}
          <option value="new">New manual account …</option>
          {perSource && <option value="skip">Skip these rows</option>}
        </Select>
      </div>
      {choice.kind === "new" && <NewAccountFields choice={choice} onChange={onChange} />}
    </div>
  );
}

function NewAccountFields({
  choice,
  onChange
}: {
  choice: Extract<TargetChoice, {
    kind: "new";
  }>;
  onChange: (choice: TargetChoice) => void;
}) {
  const balanceName = useId();
  const change = (update: Partial<typeof choice>) => onChange({
    ...choice,
    ...update
  });

  return (
    <div className={styles["new-account"]}>
      <label>
        Account name
        <input
          value={choice.name}
          maxLength={100}
          onChange={event => change({
            name: event.target.value
          })}
        />
      </label>
      <label>
        Currency
        <input
          value={choice.currency}
          maxLength={3}
          autoCapitalize="characters"
          onChange={event => change({
            currency: event.target.value.toUpperCase()
          })}
        />
      </label>
      <fieldset className={styles["balance"]}>
        <legend>Balance</legend>
        <div className={styles["balance-kinds"]}>
          <label>
            <input
              type="radio"
              name={balanceName}
              checked={choice.balanceKind === "current"}
              onChange={() => change({
                balanceKind: "current"
              })}
            />
            Current balance today
          </label>
          <label>
            <input
              type="radio"
              name={balanceName}
              checked={choice.balanceKind === "start"}
              onChange={() => change({
                balanceKind: "start"
              })}
            />
            Balance at the start of the file
          </label>
        </div>
        <input
          aria-label="Balance amount"
          inputMode="decimal"
          placeholder="0.00"
          value={choice.balance}
          onChange={event => change({
            balance: event.target.value
          })}
        />
        <span className={ui["form-hint"]}>{choice.balanceKind === "current" ? "The difference to the imported rows is booked as an opening balance on the file's first date." : "Booked as the opening balance on the file's first date."} Leave empty to start from zero.</span>
      </fieldset>
    </div>
  );
}
