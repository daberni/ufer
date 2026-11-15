"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./sync-button.module.css";
import { Check, CircleHelp, RefreshCw, X } from "lucide-react";
import { useSyncFeedback } from "@/features/banking/use-sync-feedback";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "bankAccounts" | "busy" | "perform">;

export function SyncButton({
  bankAccounts,
  busy,
  perform
}: Props) {
  const {
    open,
    syncing,
    outcome,
    requestError,
    hasProblem,
    sync,
    dismiss
  } = useSyncFeedback(perform);

  const showResult = open && !syncing && Boolean(outcome || requestError);

  const transactionLabel = outcome?.inserted === 1 ? "transaction" : "transactions";

  const messages = [
    outcome ? `${outcome.inserted} new ${transactionLabel} synced.` : "",
    requestError ? `Sync failed: ${requestError}` : "",
    ...(outcome?.failures ?? [])
  ].filter(Boolean);

  // Start and finish are announced here without a visible card while syncing.
  const resultAnnouncement = showResult ? messages.join(" ") : "";

  const announcement = syncing ? "Syncing transactions …" : resultAnnouncement;

  const working = syncing || busy;

  const idleLabel = busy ? "Processing …" : "Sync";

  const buttonLabel = syncing ? "Syncing …" : idleLabel;

  return (
    <div className={styles["sync"]}>
      <button
        className={clsx(styles["button"], ui["primary"])}
        disabled={working || !bankAccounts.length}
        aria-busy={working}
        onClick={sync}
      >
        <RefreshCw size={15} className={working ? ui["spinning"] : ""} />
        {buttonLabel}
      </button>
      <div
        className={styles["announcer"]}
        role="status"
        aria-live={hasProblem ? "assertive" : "polite"}
      >
        {announcement}
      </div>
      {showResult && (
        <div className={clsx(styles["popover"], hasProblem && styles["problem"])}>
          <span className={styles["icon"]}>
            {hasProblem ? <CircleHelp size={16} /> : <Check size={16} />}
          </span>
          <div className={styles["text"]}>
            {messages.map(message => (
              <p key={message}>{message}</p>
            ))}
          </div>
          <button className={clsx(ui["icon-button"], styles["dismiss"])} aria-label="Dismiss sync status" onClick={dismiss}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
