import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import { TimestampValue } from "@/components/ui/date-value";
import { accountSource } from "@/features/accounts/account-presentation";
import type { Account } from "@/features/accounts/types";
import styles from "./account-source-status.module.css";

type Props = {
  account: Pick<Account, "provider" | "institution" | "requisition_id" | "last_synced_at" | "valid_until" | "sync_error" | "archived_at">;
  /** Shows when a synced account last synced; compact rows leave it out. */
  withDate?: boolean;
};

const stateLabels = {
  attention: "Needs attention",
  error: "Sync error",
  archived: "Archived"
};

/** An account's source and sync state, shared by account cards, list rows and details so they use one vocabulary. */
export function AccountSourceStatus({
  account,
  withDate = false
}: Props) {
  const {
    label,
    state
  } = accountSource(account, Temporal.Now.instant());
  const dot = <span className={clsx(styles["dot"], styles[state.kind])} aria-hidden="true" />;

  // A manual account has no sync state, so its neutral dot sits beside the source itself.
  if (state.kind === "manual") {
    return (
      <span className={styles["status"]}>
        <span className={styles["state"]}>
          {dot}
          <span>{label}</span>
        </span>
      </span>
    );
  }

  return (
    <span className={styles["status"]}>
      <span className={styles["label"]}>{label}</span>
      <span className={styles["separator"]} aria-hidden="true">·</span>
      <span className={clsx(styles["state"], state.kind === "attention" && styles["problem"], state.kind === "error" && styles["failed"])} title={state.kind === "error" ? account.sync_error ?? undefined : undefined}>
        {dot}
        <span>{state.kind === "synced" ? <SyncedLabel at={state.at} withDate={withDate} /> : stateLabels[state.kind]}</span>
      </span>
    </span>
  );
}

function SyncedLabel({
  at,
  withDate
}: {
  at: string | null;
  withDate: boolean;
}) {
  if (at === null) {
    return <>Not synced yet</>;
  }

  return withDate ? <>Synced <TimestampValue value={at} /></> : <>Synced</>;
}
