"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./connections-view.module.css";
import { Landmark, Link2, Plus, ShieldCheck } from "lucide-react";
import { date } from "@/features/dashboard/presentation";
import { Empty } from "@/components/ui/empty-state";
import { BridgeIllustration } from "@/components/branding/illustrations";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "openBank" | "state">;

export function ConnectionsView({
  busy,
  openBank,
  state
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <>
      <div className={ui["section-heading"]}>
        <span className={ui["section-kicker"]}>ENABLE BANKING · {state.environment}</span>
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
      {!state.bankingConfigured && <div className={clsx(ui["notice"], ui["warning"])}>Configure the application ID and private key on the server to enable bank access.</div>}
      <section className={ui["panel"]}>
        {state.connections.length ? (
          <div className={styles["connections-list"]}>
            {state.connections.map(connection => (
              <div className={styles["connection-row"]} key={connection.id}>
                <span className={clsx(ui["account-logo"], styles["checking"])}>
                  <Landmark size={23} />
                </span>
                <div>
                  <h3>{connection.bank_name}</h3>
                  <p>
                    {connection.bank_country} · {connection.valid_until ? `Authorized until ${date(connection.valid_until)}` : "Authorization not completed yet"}
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
                <button className={clsx(styles["button"], ui["small"])} disabled={busy} onClick={() => openBank(connection)}>
                  Reconnect
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Your first bank connection" illustration={BridgeIllustration}>
            Choose an available sandbox bank to test the complete flow with synthetic data.
            <button className={clsx(styles["button"], ui["primary"])} onClick={() => openBank()}>
              <Link2 size={15} />
              Select sandbox bank
            </button>
          </Empty>
        )}
      </section>
      {state.runs.length > 0 && (
        <section className={clsx(ui["panel"], styles["sync-history"])}>
          <div className={ui["card-heading"]}>
            <h2>Recent syncs</h2>
          </div>
          {state.runs.map(run => (
            <div className={styles["sync-row"]} key={run.id}>
              <span>{date(run.started_at)}</span>
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
