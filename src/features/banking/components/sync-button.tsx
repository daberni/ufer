"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId, useRef, useState } from "react";
import styles from "./sync-button.module.css";
import { Check, RefreshCw } from "lucide-react";
import { LiveAnnouncements } from "@/components/ui/live-announcements";
import { useDismiss } from "@/components/ui/use-dismiss";
import { SyncProblemDetails } from "@/features/banking/components/sync-problem-details";
import { useSyncStatus, type SyncPhase, type SyncProblem } from "@/features/banking/use-sync-status";
import type { Account } from "@/features/accounts/types";
import { useSyncRuns } from "@/features/banking/queries";
import { useDisplayTimeZone } from "@/components/ui/use-display-time-zone";
import { useLocale } from "@/client/locale-provider";
import { useTranslations } from "next-intl";
import { Temporal } from "temporal-polyfill";
import { describeDate } from "@/lib/date-format";
import { syncRunTone } from "@/features/banking/sync-run-presentation";

type Props = {
  bankAccounts: Account[];
  /** Shows the bank connections, where failed accounts are reauthorized. */
  showConnections: () => void;
};

// The button reflects only its own sync; other dashboard actions never change it.
export function SyncButton({
  bankAccounts,
  showConnections
}: Props) {
  const {
    phase,
    resultLabel,
    problem,
    politeAnnouncement,
    assertiveAnnouncement,
    sync,
    dismissProblem
  } = useSyncStatus();

  const t = useTranslations("banking.sync");

  const [detailsOpen, setDetailsOpen] = useState(false);

  const container = useRef<HTMLDivElement>(null);

  const syncButton = useRef<HTMLButtonElement>(null);

  const badge = useRef<HTMLButtonElement>(null);

  const detailsId = useId();

  const lastSyncId = useId();

  const lastSync = useLastSyncLabel();

  const syncing = phase === "syncing";

  const idleLabel = t("idle");

  const syncingLabel = t("syncing");

  const visibleLabel = buttonText(phase, resultLabel, idleLabel, syncingLabel);

  // Every state's icon and label share one grid cell, so the button keeps the width of the longest one.
  const layers = [...new Set([idleLabel, syncingLabel, t("upToDate"), resultLabel])].filter(Boolean);

  function startSync() {
    // aria-disabled instead of disabled keeps keyboard focus on the button while it syncs.
    if (syncing) {
      return;
    }

    sync();
  }

  // The container also holds the badge, so pressing it toggles the details instead of dismissing and reopening them.
  useDismiss({
    active: Boolean(problem) && detailsOpen,
    inside: [container],
    onDismiss: dismissal => closeDetails(dismissal.focusInside)
  });

  function closeDetails(restoreFocus: boolean) {
    setDetailsOpen(false);

    if (restoreFocus) {
      badge.current?.focus();
    }
  }

  function dismiss() {
    setDetailsOpen(false);
    dismissProblem();
    // The badge and its details disappear, so focus returns to the button they belong to.
    syncButton.current?.focus();
  }

  function openConnections() {
    closeDetails(true);
    showConnections();
  }

  return (
    <div ref={container} className={styles["sync"]} title={lastSync}>
      <button
        ref={syncButton}
        type="button"
        className={clsx(styles["button"], ui["primary"])}
        disabled={!bankAccounts.length}
        aria-disabled={syncing || undefined}
        aria-busy={syncing}
        aria-label={accessibleName(phase, visibleLabel, problem, t)}
        aria-describedby={lastSync ? lastSyncId : undefined}
        onClick={startSync}
      >
        <span className={styles["layers"]}>
          {layers.map(label => (
            <span key={label} className={clsx(styles["layer"], label === visibleLabel && styles["visible"])}>
              <LayerIcon icon={layerIcon(label, idleLabel, syncingLabel)} syncing={syncing} />
              <span className={styles["text"]}>{label}</span>
            </span>
          ))}
        </span>
      </button>
      {problem && (
        <button
          ref={badge}
          type="button"
          className={styles["badge"]}
          aria-label={t("showProblems", {
            problem: problem.buttonLabel
          })}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen(open => !open)}
        >
          {problem.failures.length || "!"}
        </button>
      )}
      {problem && detailsOpen && (
        <SyncProblemDetails
          id={detailsId}
          problem={problem}
          onDismiss={dismiss}
          onOpenConnections={openConnections}
        />
      )}
      {lastSync && <span id={lastSyncId} hidden>{lastSync}</span>}
      <LiveAnnouncements polite={politeAnnouncement} assertive={assertiveAnnouncement} />
    </div>
  );
}

// The latest run's time and outcome, shown as the button's tooltip and description; empty until the runs load.
function useLastSyncLabel() {
  const locale = useLocale();
  const timeZone = useDisplayTimeZone();
  const runs = useSyncRuns();
  const t = useTranslations("banking.syncRuns");

  if (!runs.data) {
    return undefined;
  }

  const run = runs.data[0];

  if (!run) {
    return t("none");
  }

  const date = describeDate(Temporal.Instant.from(run.started_at).toZonedDateTimeISO(timeZone), locale).label;

  return t("last", {
    date,
    tone: syncRunTone(run.status)
  });
}

type LayerIconKind = "idle" | "syncing" | "done";

function layerIcon(label: string, idleLabel: string, syncingLabel: string): LayerIconKind {
  if (label === syncingLabel) {
    return "syncing";
  }

  if (label === idleLabel) {
    return "idle";
  }

  return "done";
}

function LayerIcon({
  icon,
  syncing
}: {
  icon: LayerIconKind;
  syncing: boolean
}) {
  if (icon === "syncing") {
    return <RefreshCw size={15} className={clsx(syncing && ui["spinning"])} />;
  }

  if (icon === "idle") {
    return <RefreshCw size={15} />;
  }

  return <Check size={15} />;
}

function buttonText(phase: SyncPhase, resultLabel: string, idleLabel: string, syncingLabel: string) {
  if (phase === "syncing") {
    return syncingLabel;
  }

  if (phase === "synced") {
    return resultLabel;
  }

  return idleLabel;
}

function accessibleName(phase: SyncPhase, visibleLabel: string, problem: SyncProblem | null, t: ReturnType<typeof useTranslations<"banking.sync">>) {
  if (phase === "synced") {
    return t("synced", {
      label: visibleLabel
    });
  }

  // Phones show only the icon, so the idle name says what the button covers; it starts with the visible "Sync" for speech input.
  if (phase === "idle" && problem) {
    return t("allAccountsProblem", {
      problem: problem.buttonLabel
    });
  }

  if (phase === "idle") {
    return t("allAccounts");
  }

  return visibleLabel;
}
