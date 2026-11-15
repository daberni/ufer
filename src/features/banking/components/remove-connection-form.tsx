"use client";

import ui from "../../../components/ui/primitives.module.css";

import { Trash2 } from "lucide-react";
import styles from "./remove-connection-form.module.css";
import { FormError } from "@/components/ui/form-error";
import type { Feedback } from "@/components/ui/use-action-feedback";
import type { Account, Connection, ConnectionRemoval } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useRemoveConnection } from "@/features/banking/mutations";

type Props = Pick<DashboardController, "reportFeedback"> & DialogFormProps & {
  accounts: Account[];
  selectedConnection: Connection;
};

export function RemoveConnectionForm({
  accounts,
  close,
  reportFeedback,
  selectedConnection
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useRemoveConnection(), close);
  const linkedAccounts = accounts.filter(account => account.requisition_id === selectedConnection.id);

  return (
    <form
      onSubmit={event => submit(event, () => selectedConnection.id, removal => {
        const warning = revocationWarning(selectedConnection, removal);

        if (warning) {
          reportFeedback(warning);
        }
      })}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>
        {selectedConnection.bank_name} · {selectedConnection.bank_country}
      </p>
      <ul className={styles["effects"]}>
        <li>
          <strong>{linkedAccounts.length} linked account(s) stay in Ufer</strong> with their balances, transaction history and categories.
        </li>
        <li>These accounts are no longer synced, including scheduled syncs. Their balances stay at the last synced value.</li>
        <li>The stored bank authorization is deleted and Ufer asks Enable Banking to revoke it.</li>
        <li>Connecting the same bank again later continues the kept accounts instead of creating duplicates.</li>
      </ul>
      <FormError message={error} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={pending}
          onClick={close}
        >
          Cancel
        </button>
        <button className={styles["danger"]} disabled={pending}>
          <Trash2 size={15} />
          Remove connection
        </button>
      </div>
    </form>
  );
}

// The removed connection disappears from the list; only an unconfirmed revocation needs a message after the dialog closes.
function revocationWarning(connection: Connection, removal: ConnectionRemoval): Feedback | null {
  if (removal.providerRevocation !== "not_revoked") {
    return null;
  }

  return {
    tone: "problem",
    messages: [`${connection.bank_name} removed. Enable Banking did not confirm revoking the authorization; it ends when it expires or when you withdraw it at your bank.`]
  };
}
