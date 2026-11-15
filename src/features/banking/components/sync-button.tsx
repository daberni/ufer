"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./sync-button.module.css";
import { RefreshCw } from "lucide-react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { useSyncFeedback } from "@/features/banking/use-sync-feedback";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "bankAccounts" | "busy" | "perform" | "view">;

export function SyncButton({
  bankAccounts,
  busy,
  perform,
  view
}: Props) {
  const {
    syncing,
    feedback,
    sync,
    dismiss
  } = useSyncFeedback(perform, view);

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
      <ActionFeedback
        feedback={feedback}
        dismissLabel="Dismiss sync status"
        onDismiss={dismiss}
        placement="anchored"
        pendingAnnouncement={syncing ? "Syncing transactions …" : ""}
      />
    </div>
  );
}
