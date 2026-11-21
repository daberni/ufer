"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";
import styles from "./account-summary.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import { Archive, Pencil } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { useLocale } from "@/client/locale-provider";
import { TimestampValue } from "@/components/ui/date-value";
import { money } from "@/lib/money";
import { accountIcon, accountProblem, kinds } from "@/features/accounts/account-presentation";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import type { Account } from "@/features/accounts/types";
import type { Connection } from "@/features/banking/types";
import { BalanceMismatchNotice, ProblemNotice } from "./account-notices";
import { AccountSourceStatus } from "./account-source-status";
import { ValuationDialog } from "./valuation-form";

/**
 * An account's type, balance, source and at most one notice: the archive notice, a problem that stops syncing, or a bank balance that differs from the bookings,
 * in that order. Its name and actions live in the page heading.
 */
export function AccountSummary({
  account,
  connections
}: {
  account: Account;
  connections: Connection[];
}) {
  const locale = useLocale();
  const [reconnecting, setReconnecting] = useState<Connection | null>(null);
  const [updatingBalance, setUpdatingBalance] = useState(false);
  const Icon = accountIcon(account.kind);
  const archived = account.archived_at !== null;
  // A synced account's balance follows its bank bookings and is corrected by reconciling; an archived account is read-only until it is restored.
  const balanceEditable = account.provider === "manual" && !archived;
  const connection = connections.find(item => item.id === account.requisition_id) ?? null;
  const problem = accountProblem(account, Temporal.Now.instant());
  const difference = account.reported_difference_minor ?? 0;
  const mismatch = !archived && !problem && difference !== 0;

  return (
    <section className={clsx(ui["panel"], styles["summary"])} aria-label="Account summary">
      <div className={styles["header"]}>
        <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
          <Icon size={23} aria-hidden="true" />
        </span>
        <p className={styles["meta"]}>{kinds[account.kind] ?? account.kind}</p>
      </div>
      <div className={styles["balance-row"]}>
        <strong className={styles["balance"]}>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency, locale)}</strong>
        {balanceEditable && (
          <button
            className={clsx(ui["icon-button"], styles["balance-edit"])}
            aria-label={`Update balance of ${account.name}`}
            title="Update balance"
            onClick={() => setUpdatingBalance(true)}
          >
            <Pencil size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className={styles["status"]}>
        <AccountSourceStatus account={account} withDate />
      </p>
      {account.archived_at && <ArchivedHint archivedAt={account.archived_at} />}
      {problem && <ProblemNotice problem={problem} connection={connection} reconnect={() => connection && setReconnecting(connection)} />}
      {mismatch && <BalanceMismatchNotice account={account} difference={difference} />}
      {reconnecting && <BankConnectionDialog connection={reconnecting} close={() => setReconnecting(null)} />}
      {updatingBalance && <ValuationDialog selectedAccount={account} close={() => setUpdatingBalance(false)} />}
    </section>
  );
}

/** A quiet line instead of a notice: archiving is a deliberate state, not a problem; restoring lives in the menu. */
function ArchivedHint({ archivedAt }: {
  archivedAt: string
}) {
  return (
    <p className={styles["status"]}>
      <Archive size={14} aria-hidden="true" />
      <span>Archived on <TimestampValue value={archivedAt} /> · hidden from lists, still counted in reports</span>
    </p>
  );
}

export function AccountSummarySkeleton() {
  return (
    <section className={clsx(ui["panel"], styles["summary"])}>
      <div className={styles["header"]}>
        <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
        <span className={clsx(styles["meta"], ui["skeleton"])}>Current account</span>
      </div>
      <div className={styles["balance-row"]}>
        <strong className={styles["balance"]}>
          <span className={ui["skeleton"]}>€0,000.00</span>
        </strong>
      </div>
      <p className={styles["status"]}>
        <span className={ui["skeleton"]}>Example bank · Synced 12 Jan</span>
      </p>
    </section>
  );
}
