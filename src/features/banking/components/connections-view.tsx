"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./connections-view.module.css";
import { Landmark, Link2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { TimestampValue } from "@/components/ui/date-value";
import { Empty } from "@/components/ui/empty-state";
import { BridgeIllustration } from "@/components/branding/illustrations";
import type { BankingStatus, Connection, SyncRun } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "openBank" | "openConnectionRemoval"> & {
  banking: BankingStatus;
  connections: Connection[];
  syncRuns: SyncRun[];
};

export function ConnectionsView({
  banking,
  connections,
  openBank,
  openConnectionRemoval,
  syncRuns
}: Props) {
  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={ui["section-kicker"]}>ENABLE BANKING · {banking.environment}</span>
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
          <div className={styles["connections-list"]}>
            {connections.map(connection => (
              <div className={styles["connection-row"]} key={connection.id}>
                <span className={clsx(ui["account-logo"], styles["checking"])}>
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
                    onClick={() => openConnectionRemoval(connection)}
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
                Select sandbox bank
              </button>
            )}
          >
            Choose an available sandbox bank to test the complete flow with synthetic data.
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
              <span>{run.inserted_count} new transactions</span>
              {run.error && <p className={ui["error-text"]}>{run.error}</p>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
