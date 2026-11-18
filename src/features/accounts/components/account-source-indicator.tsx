import { clsx } from "clsx";
import styles from "./account-source-indicator.module.css";
import type { Account } from "@/features/accounts/types";

type Props = {
  account: Pick<Account, "provider" | "requisition_id" | "sync_error">;
};

/** The source stays distinct from a connection problem; an error never changes where the account came from. */
export function AccountSourceIndicator({ account }: Props) {
  const manual = account.provider === "manual";
  let problem = "";

  if (!manual && account.sync_error) {
    problem = "Check sync";
  } else if (!manual && !account.requisition_id) {
    problem = "Not connected";
  }

  return (
    <span className={styles["indicator"]}>
      <span className={styles["source"]}>
        <span className={clsx(styles["dot"], !manual && styles["bank"], !manual && !problem && styles["connected"])} aria-hidden="true" />
        {manual ? "Manual" : "Bank sync"}
      </span>
      {problem && <span className={styles["problem"]} title={account.sync_error || undefined}>{problem}</span>}
    </span>
  );
}
