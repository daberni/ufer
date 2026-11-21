"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";
import styles from "./account-summary.module.css";

import { clsx } from "clsx";
import { useId, useState } from "react";
import { Pencil } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { TimestampValue } from "@/components/ui/date-value";
import { FormError } from "@/components/ui/form-error";
import { useDisplayTimeZone } from "@/components/ui/use-display-time-zone";
import { shortMonthWithYear } from "@/lib/date-format";
import { money } from "@/lib/money";
import { accountIcon, accountProblem, kinds } from "@/features/accounts/account-presentation";
import { useArchiveAccount, useRestoreAccount } from "@/features/accounts/mutations";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import type { Account } from "@/features/accounts/types";
import type { Connection } from "@/features/banking/types";
import { AccountMenu } from "./account-menu";
import { BalanceMismatchNotice, ProblemNotice } from "./account-notices";
import { ValuationDialog } from "./valuation-form";

/**
 * An account's name, balance and at most one notice: the archive notice, a problem that stops syncing, or a bank balance that differs from the bookings,
 * in that order. A healthy bank account shows one status line instead; rare actions live in the menu.
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
  const archive = useArchiveAccount(account.id);
  const restore = useRestoreAccount(account.id);
  const headingId = useId();
  const Icon = accountIcon(account.kind);
  const archived = account.archived_at !== null;
  // A synced account's balance follows its bank bookings and is corrected by reconciling; an archived account is read-only until it is restored.
  const balanceEditable = account.provider === "manual" && !archived;
  const connection = connections.find(item => item.id === account.requisition_id) ?? null;
  const problem = accountProblem(account, Temporal.Now.instant());
  const difference = account.reported_difference_minor ?? 0;
  const mismatch = !archived && !problem && difference !== 0;
  const failure = archive.error ?? restore.error;

  return (
    <section className={clsx(ui["panel"], styles["summary"])} aria-labelledby={headingId}>
      <div className={styles["header"]}>
        <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
          <Icon size={23} aria-hidden="true" />
        </span>
        <div className={styles["identity"]}>
          <h2 id={headingId} className={styles["name"]}>{account.name}</h2>
          <p className={styles["meta"]}>{account.institution} · {kinds[account.kind] ?? account.kind}</p>
        </div>
        <AccountMenu
          account={account}
          archive={archive}
          restore={restore}
          reconnect={connection && !archived && !problem ? {
            connection,
            open: () => setReconnecting(connection)
          } : null}
        />
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
      {account.provider !== "manual" && !archived && !problem && <SyncStatus account={account} />}
      <FormError failure={failure ? toFailure(failure) : null} />
      {archived && <p className={clsx(ui["notice"], styles["notice"])}>This account is archived. It is hidden from the account lists and pickers and is not synced; its history still counts in reports.</p>}
      {problem && <ProblemNotice problem={problem} connection={connection} reconnect={() => connection && setReconnecting(connection)} />}
      {mismatch && <BalanceMismatchNotice account={account} difference={difference} />}
      {reconnecting && <BankConnectionDialog connection={reconnecting} close={() => setReconnecting(null)} />}
      {updatingBalance && <ValuationDialog selectedAccount={account} close={() => setUpdatingBalance(false)} />}
    </section>
  );
}

/** One line for a healthy bank account: when it last synced and how long its authorization lasts. */
function SyncStatus({ account }: {
  account: Account
}) {
  const locale = useLocale();
  const timeZone = useDisplayTimeZone();
  const connected = account.requisition_id !== null;
  const authorizedUntil = connected && account.valid_until ? shortMonthWithYear(Temporal.PlainYearMonth.from(Temporal.Instant.from(account.valid_until).toZonedDateTimeISO(timeZone).toPlainDate()), locale) : null;
  const synced = account.last_synced_at !== null;

  return (
    <p className={styles["status"]}>
      <span className={clsx(ui["status-dot"], !(connected && synced) && styles["idle"])} aria-hidden="true" />
      <span>
        {synced ? <>Synced <TimestampValue value={account.last_synced_at} /></> : "Not synced yet"}
        {connected ? authorizedUntil && <> · authorized until {authorizedUntil}</> : " · no bank connection"}
      </span>
    </p>
  );
}

export function AccountSummarySkeleton() {
  return (
    <section className={clsx(ui["panel"], styles["summary"])}>
      <div className={styles["header"]}>
        <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
        <div className={styles["identity"]}>
          <span className={clsx(styles["name"], ui["skeleton"])}>Example account</span>
          <span className={clsx(styles["meta"], ui["skeleton"])}>Example bank · Current account</span>
        </div>
      </div>
      <div className={styles["balance-row"]}>
        <strong className={styles["balance"]}>
          <span className={ui["skeleton"]}>€0,000.00</span>
        </strong>
      </div>
      <p className={styles["status"]}>
        <span className={ui["skeleton"]}>Synced 12 Jan · authorized until May 2027</span>
      </p>
    </section>
  );
}
