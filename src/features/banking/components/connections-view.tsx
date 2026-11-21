"use client";

import ui from "../../../components/ui/primitives.module.css";
import accountStyles from "../../accounts/components/account-presentation.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import styles from "./connections-view.module.css";
import { CircleAlert, CircleCheck, CircleX, Landmark, Link2, LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { DateTimeValue, TimestampValue } from "@/components/ui/date-value";
import { Empty } from "@/components/ui/empty-state";
import { BridgeIllustration } from "@/components/branding/illustrations";
import { bankConnectionsSectionId } from "@/features/banking/connections-location";
import type { BankingConfiguration, Connection, ConnectionRemoval, SyncRun } from "@/features/banking/types";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import { useState } from "react";
import { BankConnectionDialog } from "./bank-connection-form";
import { RemoveConnectionDialog } from "./remove-connection-form";
import { useSyncRunHref } from "@/client/use-app-url";
import { recentSyncRuns, syncRunProblems, syncRunTone, type SyncRunTone } from "@/features/banking/sync-run-presentation";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import type { Area } from "@/components/ui/use-area-result";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

type Props = {
  banking: BankingConfiguration;
  connections: Area<Connection[]>;
  syncRuns: Area<SyncRun[]>;
};

type OpenDialog = {
  kind: "bank";
  /** The connection to reauthorize; null connects a new bank. */
  connection: Connection | null;
} | {
  kind: "removeConnection";
  connection: Connection;
};

const skeletonConnections = 2;

export function ConnectionsSection({
  banking,
  connections,
  syncRuns
}: Props) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const closeDialog = () => setDialog(null);
  const openBank = (connection: Connection | null = null) => setDialog({
    kind: "bank",
    connection
  });
  const removeConnection = (connection: Connection) => setDialog({
    kind: "removeConnection",
    connection
  });
  const sandbox = banking.environment === "SANDBOX";
  const removalFeedback = useActionFeedback();
  const reportRemoval = (removal: ConnectionRemoval) => {
    if (removal.notArchived.length) {
      removalFeedback.report({
        tone: "problem",
        messages: [`Not archived because their balance is not 0: ${removal.notArchived.join(", ")}. They stay active.`]
      });
    }
  };

  return (
    <section id={bankConnectionsSectionId} aria-labelledby="bank-connections-heading" className={styles["connections-section"]}>
      <div className={ui["section-heading"]}>
        <h2 id="bank-connections-heading">Bank connections</h2>
        <button className={clsx(ui["button"], ui["primary"])} onClick={() => openBank()}>
          <Plus size={15} />
          Connect bank
        </button>
      </div>
      <p className={styles["provider"]}>ENABLE BANKING{sandbox && " · SANDBOX"}</p>
      <div className={styles["connection-info"]}>
        <ShieldCheck size={23} />
        <div>
          <strong>Authorize directly with your bank.</strong>
          <p>Your private application key stays on your server. Bank authorizations need periodic renewal; their duration depends on the bank.</p>
        </div>
      </div>
      {!banking.configured && <div className={clsx(ui["notice"], ui["warning"])}>Configure the application ID and private key on the server to enable bank access.</div>}
      <section className={ui["panel"]}>
        {connections.status === "pending" ? (
          <AreaPlaceholder area={connections} subject="Your bank connections">
            <ConnectionRowsSkeleton />
          </AreaPlaceholder>
        ) : (
          <ConnectionRows
            connections={connections.data}
            openBank={openBank}
            removeConnection={removeConnection}
            sandbox={sandbox}
          />
        )}
      </section>
      <SyncHistory syncRuns={syncRuns} />
      {dialog?.kind === "bank" && <BankConnectionDialog connection={dialog.connection} close={closeDialog} />}
      {dialog?.kind === "removeConnection" && <RemoveConnectionDialog selectedConnection={dialog.connection} close={closeDialog} onRemoved={reportRemoval} />}
      <ActionFeedback
        feedback={removalFeedback.feedback}
        dismissLabel="Dismiss message"
        onDismiss={removalFeedback.dismiss}
        placement="overlay"
      />
    </section>
  );
}

function SyncHistory({ syncRuns }: {
  syncRuns: Area<SyncRun[]>
}) {
  const syncRunHref = useSyncRunHref();

  if (syncRuns.status !== "pending" && !syncRuns.data.length) {
    return null;
  }

  return (
    <section className={clsx(ui["panel"], styles["sync-history"])}>
      <div className={ui["card-heading"]}>
        <h2>Recent syncs</h2>
      </div>
      {syncRuns.status === "pending" ? (
        <AreaPlaceholder area={syncRuns} subject="Recent syncs">
          <SyncRowsSkeleton />
        </AreaPlaceholder>
      ) : (
        <ul className={styles["sync-table"]}>
          {syncRuns.data.map(run => (
            <SyncRunRow href={syncRunHref} key={run.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectionRows({
  connections,
  openBank,
  removeConnection,
  sandbox
}: {
  connections: Connection[];
  openBank: (connection?: Connection | null) => void;
  removeConnection: (connection: Connection) => void;
  sandbox: boolean;
}) {
  if (!connections.length) {
    return (
      <Empty
        title="Your first bank connection"
        illustration={BridgeIllustration}
        action={(
          <button className={clsx(ui["button"], ui["primary"])} onClick={() => openBank()}>
            <Link2 size={15} />
            {sandbox ? "Select sandbox bank" : "Connect your bank"}
          </button>
        )}
      >
        {sandbox ? "Choose an available sandbox bank to test the complete flow with synthetic data." : "Authorize read-only access with your bank to import accounts and transactions."}
      </Empty>
    );
  }

  return (
    <div>
      {connections.map(connection => (
        <div className={styles["connection-row"]} key={connection.id}>
          <span className={accountStyles["account-logo"]}>
            <Landmark size={23} />
          </span>
          <div>
            <h3>{connection.bank_name}</h3>
            <p className={styles["connection-detail"]}>
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
            <button className={clsx(ui["button"], ui["small"])} onClick={() => openBank(connection)}>
              Reconnect
            </button>
            <button
              className={clsx(ui["button"], ui["small"])}
              onClick={() => removeConnection(connection)}
              aria-label={`Remove ${connection.bank_name} connection`}
            >
              <Trash2 size={13} />
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectionRowsSkeleton() {
  return (
    <div>
      {Array.from({
        length: skeletonConnections
      }, (_, index) => (
        <div className={styles["connection-row"]} key={index}>
          <span className={clsx(accountStyles["account-logo"], ui["skeleton"])} />
          <div>
            <h3>
              <span className={ui["skeleton"]}>Example bank</span>
            </h3>
            <p className={styles["connection-detail"]}>
              <span className={ui["skeleton"]}>AT · Authorized until 12 Jan 2025, 10:00</span>
            </p>
          </div>
          <span className={clsx(styles["pill"], ui["skeleton"])}>Connected</span>
          <div className={styles["connection-actions"]}>
            <span className={clsx(ui["button"], ui["small"], ui["skeleton"])}>Reconnect</span>
            <span className={clsx(ui["button"], ui["small"], ui["skeleton"])}>
              <Trash2 size={13} />
              Remove
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SyncRowsSkeleton() {
  return (
    <ul className={styles["sync-table"]}>
      {Array.from({
        length: recentSyncRuns
      }, (_, index) => (
        <li className={styles["sync-row"]} key={index}>
          <span className={ui["skeleton"]}>12 Jan, 10:00</span>
          <span className={clsx(styles["sync-status"], ui["skeleton"])} />
          <span className={ui["skeleton"]}>12 new transactions</span>
        </li>
      ))}
    </ul>
  );
}

const syncStatusIndicators: Record<SyncRunTone, {
  label: string;
  Icon: typeof CircleCheck
}> = {
  success: {
    label: "Successful",
    Icon: CircleCheck
  },
  partial: {
    label: "Partial",
    Icon: CircleAlert
  },
  failed: {
    label: "Failed",
    Icon: CircleX
  },
  running: {
    label: "Running",
    Icon: LoaderCircle
  }
};

/** One run in aligned columns: time, status indicator, result, and its problems beneath the result. */
function SyncRunRow({
  href,
  run
}: {
  href: (runId: string) => string;
  run: SyncRun;
}) {
  const tone = syncRunTone(run.status);
  const {
    label,
    Icon
  } = syncStatusIndicators[tone];
  const problems = syncRunProblems(run.error);

  return (
    <li className={styles["sync-row"]}>
      <span className={styles["sync-time"]}><DateTimeValue value={run.started_at} /></span>
      <span className={clsx(styles["sync-status"], styles[tone])} title={label}>
        <Icon aria-hidden size={16} />
        <span className={ui["visually-hidden"]}>{label}</span>
      </span>
      <span className={styles["sync-result"]}>
        <SyncRunTransactions href={href} run={run} />
      </span>
      {problems.length > 0 && (
        <ul className={styles["sync-problems"]}>
          {problems.map((problem, index) => <li key={index}>{problem}</li>)}
        </ul>
      )}
    </li>
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
  const locale = useLocale();
  const label = (count: number) => `${formatCount(count, locale)} new ${count === 1 ? "transaction" : "transactions"}`;

  if (run.linked_count > 0) {
    return <Link className={styles["transactions-link"]} href={href(run.id)}>{label(run.linked_count)}</Link>;
  }

  if (run.inserted_count > 0) {
    return <span>{label(run.inserted_count)} · not traceable to this sync</span>;
  }

  return <span>No new transactions</span>;
}
