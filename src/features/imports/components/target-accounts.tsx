"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./target-accounts.module.css";
import { Select } from "@/components/ui/select";
import { InlineFailure } from "@/components/ui/area-placeholder";
import { accountLabel, newAccountChoice, rowCount, type AccountProblem, type TargetChoice } from "@/features/imports/import-plan";
import { FieldProblem, problemProps } from "./field-problem";
import { accountKinds, type AccountKind } from "@/features/accounts/account-kinds";
import { kinds } from "@/features/accounts/account-presentation";
import type { Account } from "@/features/accounts/types";
import type { ImportDraft } from "./use-import-draft";
import { useLocale } from "@/client/locale-provider";

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
      {draft.accountsFailure && <InlineFailure failure={draft.accountsFailure} subject="Your accounts" />}
      {!draft.accountsReady && !draft.accountsFailure && <p className={ui["form-hint"]}>Loading your accounts …</p>}
      {/* An explicit choice before the accounts load would override the preselection of a same-named account. */}
      <fieldset className={styles["targets"]} disabled={draft.inputsLocked || !draft.accountsReady}>
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
            problems={draft.prepared?.problems.filter((problem): problem is AccountProblem => problem.field !== "category" && problem.source === source) ?? []}
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
  problems,
  onChange
}: {
  source: string;
  rows: number;
  perSource: boolean;
  choice: TargetChoice;
  accounts: Account[];
  problems: AccountProblem[];
  onChange: (choice: TargetChoice) => void;
}) {
  const locale = useLocale();
  const selectId = useId();
  const targetProblem = problems.find(problem => problem.field === "target");
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
    <div className={clsx(styles["target"], perSource && styles["listed"], problems.length > 0 && styles["incomplete"])}>
      <div className={styles["choice"]}>
        {perSource ? (
          <label htmlFor={selectId} className={styles["source"]}>
            <strong>{source || "No account value"}</strong>
            <span>{rowCount(rows, locale)}</span>
          </label>
        ) : (
          <label htmlFor={selectId} className={ui["visually-hidden"]}>Target account</label>
        )}
        <div className={styles["control"]}>
          <Select
            id={selectId}
            value={value}
            {...problemProps(targetProblem, `${selectId}-problem`)}
            onChange={event => select(event.target.value)}
          >
            <option value="">Choose an account</option>
            {manual.length > 0 && (
              <optgroup label="Manual accounts">
                {manual.map(account => <option key={account.id} value={account.id}>{accountLabel(account, accounts)}</option>)}
              </optgroup>
            )}
            {linked.length > 0 && (
              <optgroup label="Bank-linked accounts">
                {linked.map(account => <option key={account.id} value={account.id}>{accountLabel(account, accounts)}</option>)}
              </optgroup>
            )}
            <option value="new">New manual account …</option>
            {perSource && <option value="skip">Skip these rows</option>}
          </Select>
          <FieldProblem problem={targetProblem} id={`${selectId}-problem`} />
        </div>
      </div>
      {choice.kind === "new" && <NewAccountFields choice={choice} problems={problems} onChange={onChange} />}
    </div>
  );
}

function NewAccountFields({
  choice,
  problems,
  onChange
}: {
  choice: Extract<TargetChoice, {
    kind: "new";
  }>;
  problems: AccountProblem[];
  onChange: (choice: TargetChoice) => void;
}) {
  const balanceName = useId();
  const nameProblem = problems.find(problem => problem.field === "name");
  const currencyProblem = problems.find(problem => problem.field === "currency");
  const balanceProblem = problems.find(problem => problem.field === "balance");
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
          {...problemProps(nameProblem, `${balanceName}-name`)}
          onChange={event => change({
            name: event.target.value
          })}
        />
        <FieldProblem problem={nameProblem} id={`${balanceName}-name`} />
      </label>
      <label>
        Currency
        <input
          value={choice.currency}
          maxLength={3}
          autoCapitalize="characters"
          {...problemProps(currencyProblem, `${balanceName}-currency`)}
          onChange={event => change({
            currency: event.target.value.toUpperCase()
          })}
        />
        <FieldProblem problem={currencyProblem} id={`${balanceName}-currency`} />
      </label>
      <label className={styles["account-type"]}>
        Account type
        <Select
          value={choice.accountKind}
          onChange={event => change({
            accountKind: event.target.value as AccountKind
          })}
        >
          {accountKinds.map(kind => <option key={kind} value={kind}>{kinds[kind]}</option>)}
        </Select>
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
          {...problemProps(balanceProblem, `${balanceName}-balance`)}
          placeholder="0.00"
          value={choice.balance}
          onChange={event => change({
            balance: event.target.value
          })}
        />
        <FieldProblem problem={balanceProblem} id={`${balanceName}-balance`} />
        <span className={ui["form-hint"]}>{choice.balanceKind === "current" ? "The difference to the imported rows is booked as an opening balance on the file's first date." : "Booked as the opening balance on the file's first date."} Leave empty to start from zero.</span>
      </fieldset>
    </div>
  );
}
