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
    outcome,
    requestError,
    hasProblem,
    sync,
    dismiss
  } = useSyncFeedback(perform);

  const showResult = open && !busy && Boolean(outcome || requestError);

  const showProgress = open && busy;

  const transactionLabel = outcome?.inserted === 1 ? "transaction" : "transactions";

  return (
    <div className={styles["sync"]}>
      <button
        className={clsx(styles["button"], ui["primary"])}
        disabled={busy || !bankAccounts.length}
        onClick={sync}
      >
        <RefreshCw size={15} className={busy ? ui["spinning"] : ""} />
        {busy ? "Processing …" : "Sync"}
      </button>
      <div
        className={clsx(styles["popover"], showResult && hasProblem && styles["problem"], !(showProgress || showResult) && styles["hidden"])}
        role="status"
        aria-live={hasProblem ? "assertive" : "polite"}
      >
        {showProgress && (
          <p className={styles["message"]}>
            <RefreshCw size={16} className={ui["spinning"]} />
            Syncing transactions …
          </p>
        )}
        {showResult && (
          <div className={styles["message"]}>
            {hasProblem ? <CircleHelp size={16} /> : <Check size={16} />}
            <div>
              {outcome && <p>{`${outcome.inserted} new ${transactionLabel} synced.`}</p>}
              {requestError && <p>{`Sync failed: ${requestError}`}</p>}
              {outcome?.failures.map(failure => (
                <p key={failure}>{failure}</p>
              ))}
            </div>
            <button className={ui["icon-button"]} aria-label="Dismiss sync status" onClick={dismiss}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
