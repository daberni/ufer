"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "../../accounts/components/account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./connections-view.module.css";
import { Landmark, Link2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { TimestampValue } from "@/components/ui/date-value";
import { Empty } from "@/components/ui/empty-state";
import { BridgeIllustration } from "@/components/branding/illustrations";
import type { BankingConfiguration, Connection, SyncRun } from "@/features/dashboard/types";
import { useState } from "react";
import { BankConnectionDialog } from "./bank-connection-form";
import { RemoveConnectionDialog } from "./remove-connection-form";
import { useSyncRunHref } from "@/features/dashboard/use-dashboard-url";

type Props = {
  banking: BankingConfiguration;
  connections: Connection[];
  syncRuns: SyncRun[];
};

type OpenDialog = {
  kind: "bank";
  /** The connection to reauthorize; null connects a new bank. */
  connection: Connection | null;
} | {
  kind: "removeConnection";
  connection: Connection;
};

export function ConnectionsView({
  banking,
  connections,
  syncRuns
}: Props) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const syncRunHref = useSyncRunHref();
  const openBank = (connection: Connection | null = null) => setDialog({
    kind: "bank",
    connection
  });
  const sandbox = banking.environment === "SANDBOX";

  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={ui["section-kicker"]}>ENABLE BANKING{sandbox && " · SANDBOX"}</span>
        <button className={clsx(styles["button"], ui["primary"])} onClick={() => openBank()}>
          <Plus size={15} />
          Connect bank
        </button>
      </div>
      <div className={styles["connection-info"]}>
        <ShieldCheck size={23} />
        <div>
          <strong>Authorize directly with your bank.</strong>
          <p>Your private application key stays on your server. Bank authorizations need periodic renewal; their duration depends on the bank.</p>
        </div>
      </div>
      {!banking.configured && <div className={clsx(ui["notice"], ui["warning"])}>Configure the application ID and private key on the server to enable bank access.</div>}
      <section className={ui["panel"]}>
        {connections.length ? (
          <div>
            {connections.map(connection => (
              <div className={styles["connection-row"]} key={connection.id}>
                <span className={accountStyles["account-logo"]}>
                  <Landmark size={23} />
                </span>
                <div>
                  <h3>{connection.bank_name}</h3>
                  <p>
                    {connection.bank_country} · {connection.valid_until ? <>Authorized until <TimestampValue value={connection.valid_until} /></> : "Authorization not completed yet"}
                  </p>
                  {connection.error && <p className={ui["error-text"]}>{connection.error}</p>}
                </div>
                <span className={clsx(styles["pill"], connection.status === "LINKED" ? styles["success"] : "")}>{({
                  LINKED: "Connected",
                  PENDING: "Pending",
                  EXCHANGING: "Connecting",
                  EXPIRED: "Expired",
                  ERROR: "Review",
                  SUPERSEDED: "Superseded"
                } as Record<string, string>)[connection.status] || connection.status}</span>
                <div className={styles["connection-actions"]}>
                  <button className={clsx(styles["button"], ui["small"])} onClick={() => openBank(connection)}>
                    Reconnect
                  </button>
                  <button
                    className={clsx(styles["button"], ui["small"])}
                    onClick={() => setDialog({
                      kind: "removeConnection",
                      connection
                    })}
                    aria-label={`Remove ${connection.bank_name} connection`}
                  >
                    <Trash2 size={13} />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Your first bank connection"
            illustration={BridgeIllustration}
            action={(
              <button className={clsx(styles["button"], ui["primary"])} onClick={() => openBank()}>
                <Link2 size={15} />
                {sandbox ? "Select sandbox bank" : "Connect your bank"}
              </button>
            )}
          >
            {sandbox ? "Choose an available sandbox bank to test the complete flow with synthetic data." : "Authorize read-only access with your bank to import accounts and transactions."}
          </Empty>
        )}
      </section>
      {syncRuns.length > 0 && (
        <section className={clsx(ui["panel"], styles["sync-history"])}>
          <div className={ui["card-heading"]}>
            <h2>Recent syncs</h2>
          </div>
          {syncRuns.map(run => (
            <div className={styles["sync-row"]} key={run.id}>
              <span><TimestampValue value={run.started_at} /></span>
              <span className={styles["pill"]}>{run.status}</span>
              <SyncRunTransactions href={syncRunHref} run={run} />
              {run.error && <p className={ui["error-text"]}>{run.error}</p>}
            </div>
          ))}
        </section>
      )}
      {dialog?.kind === "bank" && <BankConnectionDialog connection={dialog.connection} close={closeDialog} />}
      {dialog?.kind === "removeConnection" && <RemoveConnectionDialog selectedConnection={dialog.connection} close={closeDialog} />}
    </>
  );
}

/** Links a run to the transactions it imported; runs recorded before syncs stamped their transactions cannot be traced. */
function SyncRunTransactions({
  href,
  run
}: {
  href: (id: string) => string;
  run: SyncRun;
}) {
  const label = (count: number) => `${count} new ${count === 1 ? "transaction" : "transactions"}`;

  if (run.linked_count > 0) {
    return <Link className={styles["transactions-link"]} href={href(run.id)}>{label(run.linked_count)}</Link>;
  }

  if (run.inserted_count > 0) {
    return <span>{label(run.inserted_count)} · not traceable to this sync</span>;
  }

  return <span>No new transactions</span>;
}
