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
import { syncStatusLabel } from "@/features/banking/sync-run-presentation";
import { useTranslations } from "next-intl";

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
  /** False once the response confirmed that the run does not exist. */
  found: boolean;
  /** The selected run; null while its response is still loading or when it was not found. */
  run: SelectedRun;
  transactionCount: Area<number>;
}) {
  const t = useTranslations("transactions.syncRun");
  const count = transactionCount.data ?? 0;

  return (
    <div className={styles["scope-bar"]}>
      <div className={styles["scope"]}>
        <span className={clsx(ui["section-kicker"], valueMask(shownStatus(transactionCount)))}>{t("count", {
          count
        })}</span>
        <RunDescription found={found} run={run} />
      </div>
      <button className={clsx(ui["button"], ui["small"])} onClick={clear}>
        <X size={14} />
        {t("clear")}
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
  const t = useTranslations("transactions.syncRun");

  if (run) {
    return (
      <p className={styles["run"]}>
        <span>{t.rich("importedBy", {
          time: () => <TimestampValue value={run.started_at} />
        })}</span>
        <span className={ui["pill"]}>{syncStatusLabel(run.status)}</span>
      </p>
    );
  }

  if (!found) {
    return <p className={styles["run"]}>{t("notFound")}</p>;
  }

  return (
    <p className={styles["run"]}>
      <span className={ui["skeleton"]}>Imported by the sync on 16 Nov</span>
      <span className={clsx(ui["pill"], ui["skeleton"])}>Successful</span>
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
  const t = useTranslations("transactions.syncRun.empty");

  if (!run) {
    return !found && <Empty title={t("notFoundTitle")} illustration={null}>{t("notFound")}</Empty>;
  }

  if (filtered) {
    return <Empty title={t("filteredTitle")} illustration={null}>{t("filtered")}</Empty>;
  }

  if (run.inserted_count === 0) {
    return <Empty title={t("noneTitle")} illustration={null}>{t("none")}</Empty>;
  }

  return <Empty title={t("untraceableTitle")} illustration={null}>{t("untraceable")}</Empty>;
}
