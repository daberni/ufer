"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./sync-button.module.css";
import { RefreshCw } from "lucide-react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { useSyncFeedback } from "@/features/banking/use-sync-feedback";
import type { Account } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "view"> & {
  bankAccounts: Account[];
};

// The button reflects only its own sync; other dashboard actions never change it.
export function SyncButton({
  bankAccounts,
  view
}: Props) {
  const {
    syncing,
    feedback,
    sync,
    dismiss
  } = useSyncFeedback(view);

  const working = syncing;

  const buttonLabel = syncing ? "Syncing …" : "Sync";

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
