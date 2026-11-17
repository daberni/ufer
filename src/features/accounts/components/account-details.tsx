"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import { useId, useState } from "react";
import styles from "./account-details.module.css";
import { ArrowLeft, ArrowRight, Pencil, RefreshCw } from "lucide-react";
import { accountIcon, accountSourceLabel, accountSyncLabel, kinds } from "@/features/accounts/account-presentation";
import { DateValue, TimestampValue } from "@/components/ui/date-value";
import { Empty } from "@/components/ui/empty-state";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { money } from "@/lib/money";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { ValuationDialog } from "./valuation-form";
import { BalanceHistoryPanel } from "./balance-history";
import { useViewHref } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { Account, BalanceHistory } from "@/features/accounts/types";
import type { Connection } from "@/features/banking/types";

/** Where an account's details return to: the list they were opened from. */
export type BackLink = {
  href: string;
  label: string;
};

type Props = {
  account: Area<Account>;
  back: BackLink;
  /** Bank connections; a synced account offers to reauthorize its own. */
  connections: Area<Connection[]>;
  history: Area<BalanceHistory>;
};

/** An account's current balance, its source and actions beside its balance history. */
export function AccountDetails({
  account,
  back,
  connections,
  history
}: Props) {
  return (
    <>
      <BackNavigation back={back} />
      <div className={styles["details-grid"]}>
        {account.status === "pending" ? (
          <AreaPlaceholder area={account} subject="This account">
            <AccountSummarySkeleton />
          </AreaPlaceholder>
        ) : <AccountSummary account={account.data} connections={connections.data ?? []} />}
        <BalanceHistoryPanel history={history} />
      </div>
    </>
  );
}

function BackNavigation({ back }: {
  back: BackLink
}) {
  return (
    <nav className={styles["back"]} aria-label="Back">
      <Link className={ui["text-button"]} href={back.href}>
        <ArrowLeft size={15} />
        {back.label}
      </Link>
    </nav>
  );
}

/** Shown for an id that is unknown, removed or belongs to another banking environment. */
export function AccountNotFound({ back }: {
  back: BackLink
}) {
  return (
    <>
      <BackNavigation back={back} />
      <section className={ui["panel"]}>
        <Empty
          title="This account is not available"
          action={(
            <Link className={clsx(ui["button"], ui["primary"])} href={back.href}>
              {back.label} <ArrowRight size={15} />
            </Link>
          )}
        >
          It may have been removed, or the link belongs to another installation.
        </Empty>
      </section>
    </>
  );
}

type OpenDialog = {
  kind: "balance";
} | {
  kind: "bank";
  connection: Connection;
};

function AccountSummary({
  account,
  connections
}: {
  account: Account;
  connections: Connection[];
}) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const nameId = useId();
  const Icon = accountIcon(account.kind);

  return (
    <section className={clsx(ui["panel"], styles["summary"])} aria-labelledby={nameId}>
      <div className={ui["card-heading"]}>
        <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
          <Icon size={23} />
        </span>
        <span className={ui["pill"]}>{kinds[account.kind] ?? account.kind}</span>
      </div>
      <h2 id={nameId} className={styles["name"]}>{account.name}</h2>
      <p className={ui["muted"]}>{account.institution} · {account.currency}</p>
      <strong className={styles["balance"]}>{account.balance_minor === null ? "—" : money(account.balance_minor, account.currency)}</strong>
      <dl className={styles["facts"]}>
        <div>
          <dt>Balance date</dt>
          <dd><DateValue value={account.balance_date} fallback="Not recorded yet" /></dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{accountSourceLabel(account)}</dd>
        </div>
        {account.provider !== "manual" && <SyncFacts account={account} />}
      </dl>
      {account.sync_error && <p className={ui["error-text"]}>{account.sync_error}</p>}
      {account.provider === "manual" ? (
        <div className={styles["actions"]}>
          <button
            className={clsx(ui["button"], ui["primary"])}
            onClick={() => setDialog({
              kind: "balance"
            })}
          >
            <Pencil size={15} />
            Update balance
          </button>
        </div>
      ) : (
        <ConnectionActions
          account={account}
          connections={connections}
          reconnect={connection => setDialog({
            kind: "bank",
            connection
          })}
        />
      )}
      {dialog?.kind === "balance" && <ValuationDialog selectedAccount={account} close={closeDialog} />}
      {dialog?.kind === "bank" && <BankConnectionDialog connection={dialog.connection} close={closeDialog} />}
    </section>
  );
}

function SyncFacts({ account }: {
  account: Account
}) {
  return (
    <>
      <div>
        <dt>Sync</dt>
        <dd>
          <span className={clsx(styles["status-dot"], account.sync_error && styles["warn"])} aria-hidden="true" />
          {accountSyncLabel(account)}
        </dd>
      </div>
      <div>
        <dt>Last synced</dt>
        <dd><TimestampValue value={account.last_synced_at} fallback="Never" /></dd>
      </div>
      {account.requisition_id && (
        <div>
          <dt>Authorized until</dt>
          <dd><TimestampValue value={account.valid_until} fallback="Not completed" /></dd>
        </div>
      )}
    </>
  );
}

// Syncing runs for all bank accounts from the page heading; this account offers to reauthorize its own connection.
function ConnectionActions({
  account,
  connections,
  reconnect
}: {
  account: Account;
  connections: Connection[];
  reconnect: (connection: Connection) => void;
}) {
  const viewHref = useViewHref();
  const connection = connections.find(item => item.id === account.requisition_id);

  return (
    <div className={styles["actions"]}>
      {connection && (
        <button className={ui["button"]} onClick={() => reconnect(connection)}>
          <RefreshCw size={15} />
          Reconnect {connection.bank_name}
        </button>
      )}
      <Link className={ui["text-button"]} href={viewHref("connections")}>
        Manage bank connections <ArrowRight size={15} />
      </Link>
    </div>
  );
}

function AccountSummarySkeleton() {
  return (
    <section className={clsx(ui["panel"], styles["summary"])}>
      <div className={ui["card-heading"]}>
        <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
        <span className={clsx(ui["pill"], ui["skeleton"])}>Current account</span>
      </div>
      <h2 className={styles["name"]}>
        <span className={ui["skeleton"]}>Everyday account</span>
      </h2>
      <p>
        <span className={ui["skeleton"]}>Example bank · EUR</span>
      </p>
      <strong className={styles["balance"]}>
        <span className={ui["skeleton"]}>€0,000.00</span>
      </strong>
      <div className={styles["facts"]}>
        <span className={ui["skeleton"]}>Balance date 12 Jan 2025</span>
        <span className={ui["skeleton"]}>Source Bank sync</span>
      </div>
      <div className={styles["actions"]}>
        <span className={clsx(ui["button"], ui["skeleton"])}>Update balance</span>
      </div>
    </section>
  );
}
