"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./target-accounts.module.css";
import { Select } from "@/components/ui/select";
import { InlineFailure } from "@/components/ui/area-placeholder";
import { accountLabel, newAccountChoice, type AccountProblem, type TargetChoice } from "@/features/imports/import-plan";
import { FieldProblem, problemProps } from "./field-problem";
import { accountKinds, type AccountKind } from "@/features/accounts/account-kinds";
import { kinds } from "@/features/accounts/account-presentation";
import type { Account } from "@/features/accounts/types";
import { bookableManualAccounts } from "@/features/accounts/queries";
import type { ImportDraft } from "./use-import-draft";
import { useTranslations } from "next-intl";

/** One account picker for the whole file, or one per value of the mapped account column. */
export function TargetAccounts({
  draft
}: {
  draft: ImportDraft;
}) {
  const t = useTranslations("imports.targets");
  const perSource = draft.perSource;
  // Without an account column, the single picker shows before the columns are complete.
  const sources = perSource || draft.sources.length > 0 ? draft.sources : [{
    source: "",
    rows: draft.table?.rows.length ?? 0,
    currency: null
  }];

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-accounts">
      <h2 id="import-accounts">{perSource ? t("perSourceHeading") : t("singleHeading")}</h2>
      {perSource && <p className={ui["form-hint"]}>{draft.statement ? t("statementHint") : t("fileHint")}</p>}
      {perSource && !draft.mapped && <p className={ui["form-hint"]}>{t("mapFirst")}</p>}
      {draft.accountsFailure && <InlineFailure failure={draft.accountsFailure} failureTitle={t("accountsFailed")} />}
      {!draft.accountsReady && !draft.accountsFailure && <p className={ui["form-hint"]}>{t("loadingAccounts")}</p>}
      {/* An explicit choice before the accounts load would override the preselection of a same-named account. */}
      <fieldset className={styles["targets"]} disabled={draft.inputsLocked || !draft.accountsReady}>
        <legend className={ui["visually-hidden"]}>{t("legend")}</legend>
        {sources.map(({
          source,
          rows,
          currency
        }) => (
          <TargetRow
            key={source}
            source={source}
            rows={rows}
            currency={currency}
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
      {draft.targets.size > 0 && [...draft.targets.values()].some(choice => choice.kind === "existing" && draft.accounts.find(account => account.id === choice.accountId)?.provider !== "manual") && <p className={ui["form-hint"]}>{t("linkedHint")}</p>}
    </section>
  );
}

function TargetRow({
  source,
  rows,
  currency,
  perSource,
  choice,
  accounts,
  problems,
  onChange
}: {
  source: string;
  rows: number;
  currency: string | null;
  perSource: boolean;
  choice: TargetChoice;
  accounts: Account[];
  problems: AccountProblem[];
  onChange: (choice: TargetChoice) => void;
}) {
  const t = useTranslations("imports");
  const selectId = useId();
  const targetProblem = problems.find(problem => problem.field === "target");
  const manual = bookableManualAccounts(accounts);
  const linked = accounts.filter(account => account.provider !== "manual");
  let value = "";

  if (choice.kind === "existing") {
    value = choice.accountId;
  } else if (choice.kind === "new" || choice.kind === "skip") {
    value = choice.kind;
  }

  function select(next: string) {
    if (next === "new") {
      onChange(newAccountChoice(source, currency));
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
            <strong>{source || t("targets.noAccountValue")}</strong>
            <span>
              {t("rowCount", {
                count: rows
              })}
            </span>
          </label>
        ) : (
          <label htmlFor={selectId} className={ui["visually-hidden"]}>{t("targets.targetAccount")}</label>
        )}
        <div className={styles["control"]}>
          <Select
            id={selectId}
            value={value}
            {...problemProps(targetProblem, `${selectId}-problem`)}
            onChange={event => select(event.target.value)}
          >
            <option value="">{t("targets.chooseAccount")}</option>
            {manual.length > 0 && (
              <optgroup label={t("targets.manualAccounts")}>
                {manual.map(account => <option key={account.id} value={account.id}>{accountLabel(account, accounts)}</option>)}
              </optgroup>
            )}
            {linked.length > 0 && (
              <optgroup label={t("targets.linkedAccounts")}>
                {linked.map(account => <option key={account.id} value={account.id}>{accountLabel(account, accounts)}</option>)}
              </optgroup>
            )}
            <option value="new">{t("targets.newAccount")}</option>
            {perSource && <option value="skip">{t("targets.skip")}</option>}
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
  const t = useTranslations("imports.targets");
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
        {t("accountName")}
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
        {t("currency")}
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
        {t("accountType")}
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
        <legend>{t("balance")}</legend>
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
            {t("currentBalance")}
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
            {t("startBalance")}
          </label>
        </div>
        <input
          aria-label={t("balanceAmount")}
          inputMode="decimal"
          {...problemProps(balanceProblem, `${balanceName}-balance`)}
          placeholder="0.00"
          value={choice.balance}
          onChange={event => change({
            balance: event.target.value
          })}
        />
        <FieldProblem problem={balanceProblem} id={`${balanceName}-balance`} />
        <span className={ui["form-hint"]}>{choice.balanceKind === "current" ? t("currentBalanceHint") : t("startBalanceHint")}</span>
      </fieldset>
    </div>
  );
}
