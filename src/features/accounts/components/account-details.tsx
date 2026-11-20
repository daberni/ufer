"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "./account-presentation.module.css";
import contextStyles from "./account-context.module.css";

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
import { BalanceHistoryPanel } from "./balance-history";
import { AccountArchiveAction } from "./account-archive-action";
import { ValuationDialog } from "./valuation-form";
import { bankConnectionsHref } from "@/features/banking/connections-location";
import type { Area } from "@/components/ui/use-area-result";
import type { Account, BalanceHistory } from "@/features/accounts/types";
import type { Connection } from "@/features/banking/types";
import { useLocale } from "@/client/locale-provider";

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
    <nav className={contextStyles["context-row"]} aria-label="Back">
      <Link className={clsx(contextStyles["back-link"], ui["text-button"])} href={back.href}>
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

function AccountSummary({
  account,
  connections
}: {
  account: Account;
  connections: Connection[];
}) {
  const locale = useLocale();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [updatingBalance, setUpdatingBalance] = useState(false);
  const closeDialog = () => setConnection(null);
  const archived = account.archived_at !== null;
  // A synced account's balance comes from its bank; an archived account is read-only until it is restored.
  const balanceEditable = account.provider === "manual" && !archived;
  const headingId = useId();
  const Icon = accountIcon(account.kind);

  return (
    <section className={clsx(ui["panel"], styles["summary"])} aria-labelledby={headingId}>
      <div className={ui["card-heading"]}>
        <span className={clsx(accountStyles["account-logo"], accountStyles[account.kind])}>
          <Icon size={23} />
        </span>
        <span className={ui["pill"]}>{kinds[account.kind] ?? account.kind}</span>
      </div>
      {archived && <p className={clsx(ui["notice"], styles["archived"])}>This account is archived. It is hidden from the account lists and pickers and is not synced; its history still counts in reports.</p>}
      <h2 id={headingId} className={styles["heading"]}>Balance</h2>
      <p className={ui["muted"]}>{account.institution} · {account.currency}</p>
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
      <dl className={styles["facts"]}>
        <div>
          <dt>Balance date</dt>
          <dd><DateValue value={account.balance_date} fallback="Not recorded yet" /></dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{accountSourceLabel(account)}</dd>
        </div>
        {account.provider === "enable_banking" && account.provider_name && (
          <div>
            <dt>Bank account name</dt>
            <dd className={styles["provider-name"]}>{account.provider_name}</dd>
          </div>
        )}
        {account.provider !== "manual" && <SyncFacts account={account} />}
      </dl>
      {account.sync_error && <p className={ui["error-text"]}>{account.sync_error}</p>}
      {account.provider !== "manual" && (
        <ConnectionActions
          account={account}
          connections={connections}
          reconnect={setConnection}
        />
      )}
      <div className={styles["actions"]}>
        <AccountArchiveAction account={account} />
      </div>
      {connection && <BankConnectionDialog connection={connection} close={closeDialog} />}
      {updatingBalance && <ValuationDialog selectedAccount={account} close={() => setUpdatingBalance(false)} />}
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
  const connection = connections.find(item => item.id === account.requisition_id);

  return (
    <div className={styles["actions"]}>
      {connection && (
        <button className={ui["button"]} onClick={() => reconnect(connection)}>
          <RefreshCw size={15} />
          Reconnect {connection.bank_name}
        </button>
      )}
      <Link className={ui["text-button"]} href={bankConnectionsHref}>
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
      <h2 className={styles["heading"]}>Balance</h2>
      <p>
        <span className={ui["skeleton"]}>Example bank · EUR</span>
      </p>
      <div className={styles["balance-row"]}>
        <strong className={styles["balance"]}>
          <span className={ui["skeleton"]}>€0,000.00</span>
        </strong>
      </div>
      <div className={styles["facts"]}>
        <span className={ui["skeleton"]}>Balance date 12 Jan 2025</span>
        <span className={ui["skeleton"]}>Source Bank sync</span>
      </div>
    </section>
  );
}
