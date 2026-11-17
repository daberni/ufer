"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./sync-run-scope.module.css";
import { X } from "lucide-react";
import { TimestampValue } from "@/components/ui/date-value";
import { Empty } from "@/components/ui/empty-state";
import { shownStatus, valueMask } from "@/components/ui/result-presentation";
import type { Area } from "@/components/ui/use-area-result";
import type { TransactionPage } from "@/features/transactions/types";

type SelectedRun = TransactionPage["syncRun"];

/**
 * The selected sync run in place of the period controls: the list shows every transaction the run imported, whatever month or currency.
 */
export function SyncRunScope({
  clear,
  found,
  run,
  transactionCount
}: {
  clear: () => void;
  /** False once the response confirmed that the run does not exist in this environment. */
  found: boolean;
  /** The selected run; null while its response is still loading or when it was not found. */
  run: SelectedRun;
  transactionCount: Area<number>;
}) {
  const count = transactionCount.data ?? 0;

  return (
    <div className={styles["scope-bar"]}>
      <div className={styles["scope"]}>
        <span className={clsx(ui["section-kicker"], valueMask(shownStatus(transactionCount)))}>{`${count} ${count === 1 ? "TRANSACTION" : "TRANSACTIONS"}`}</span>
        <RunDescription found={found} run={run} />
      </div>
      <button className={clsx(ui["button"], ui["small"])} onClick={clear}>
        <X size={14} />
        Clear sync filter
      </button>
    </div>
  );
}

function RunDescription({
  found,
  run
}: {
  found: boolean;
  run: SelectedRun;
}) {
  if (run) {
    return (
      <p className={styles["run"]}>
        <span>Imported by the sync on <TimestampValue value={run.started_at} /></span>
        <span className={ui["pill"]}>{run.status}</span>
      </p>
    );
  }

  if (!found) {
    return <p className={styles["run"]}>This sync was not found.</p>;
  }

  return (
    <p className={styles["run"]}>
      <span className={ui["skeleton"]}>Imported by the sync on 16 Nov</span>
      <span className={clsx(ui["pill"], ui["skeleton"])}>SUCCESS</span>
    </p>
  );
}

/** Why a selected sync run lists no transactions. */
export function SyncRunEmpty({
  filtered,
  found,
  run
}: {
  /** Whether search or filters narrow the run's transactions. */
  filtered: boolean;
  found: boolean;
  run: SelectedRun;
}) {
  if (!run) {
    return !found && <Empty title="Sync not found" illustration={null}>The link may be outdated, or the sync belongs to another banking environment.</Empty>;
  }

  if (filtered) {
    return <Empty title="No matching transactions" illustration={null}>None of the transactions this sync imported match the search and filters.</Empty>;
  }

  if (run.inserted_count === 0) {
    return <Empty title="No new transactions" illustration={null}>This sync did not import any new transactions.</Empty>;
  }

  return <Empty title="Transactions not traceable" illustration={null}>This sync ran before Ufer recorded which sync imported a transaction, so its transactions cannot be listed.</Empty>;
}
