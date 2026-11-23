import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { Temporal } from "temporal-polyfill";
import { TimestampValue } from "@/components/ui/date-value";
import { accountSource } from "@/features/accounts/account-presentation";
import type { Account } from "@/features/accounts/types";
import ui from "../../../components/ui/primitives.module.css";
import styles from "./account-source-status.module.css";

type Props = {
  account: Pick<Account, "kind" | "provider" | "institution" | "requisition_id" | "last_synced_at" | "valid_until" | "sync_error" | "archived_at">;
  /** Shows when a synced account last synced; compact rows leave it out. */
  withDate?: boolean;
};

/** An account's source and sync state, shared by account cards, list rows and details so they use one vocabulary. */
export function AccountSourceStatus({
  account,
  withDate = false
}: Props) {
  const t = useTranslations("accounts.source");
  const {
    label: source,
    state
  } = accountSource(account, Temporal.Now.instant());
  const label = "institution" in source ? source.institution : t(source.generic);
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
      <span className={ui["visually-hidden"]}>, </span>
      <span className={clsx(styles["state"], state.kind === "attention" && styles["problem"], state.kind === "error" && styles["failed"])} title={state.kind === "error" ? account.sync_error ?? undefined : undefined}>
        {dot}
        <span>{state.kind === "synced" ? <SyncedLabel at={state.at} withDate={withDate} /> : t(`states.${state.kind}`)}</span>
      </span>
    </span>
  );
}

function SyncedLabel({
  at,
  withDate
}: {
  at: string;
  withDate: boolean;
}) {
  const t = useTranslations("accounts.source");

  return withDate ? t.rich("syncedAt", {
    date: () => <TimestampValue value={at} />
  }) : t("synced");
}
