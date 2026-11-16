"use client";

import ui from "../../../components/ui/primitives.module.css";

import { Trash2 } from "lucide-react";
import styles from "./remove-connection-form.module.css";
import { FormError } from "@/components/ui/form-error";
import type { Feedback } from "@/components/ui/use-action-feedback";
import type { Account } from "@/features/accounts/types";
import type { Connection, ConnectionRemoval } from "@/features/banking/types";
import { useDashboardStore } from "@/client/dashboard-store";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useRemoveConnection } from "@/features/banking/mutations";
import { useAccounts } from "@/features/accounts/queries";
import { InlineFailure } from "@/components/ui/area-placeholder";
import { useAreaResult, type Area } from "@/components/ui/use-area-result";
import { Dialog } from "@/components/ui/dialog";

type Props = DialogFormProps & {
  selectedConnection: Connection;
};

export function RemoveConnectionDialog({
  close,
  selectedConnection
}: Props) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Remove connection" onClose={close}>
      <RemoveConnectionForm close={close} selectedConnection={selectedConnection} />
    </Dialog>
  );
}

function RemoveConnectionForm({
  close,
  selectedConnection
}: Props) {
  const accounts = useAreaResult(useAccounts());
  const reportFeedback = useDashboardStore(state => state.reportFeedback);
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useRemoveConnection(), close);

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
          <RetainedAccounts accounts={accounts} connection={selectedConnection} />
        </li>
        <li>These accounts are no longer synced, including scheduled syncs. Their balances stay at the last synced value.</li>
        <li>The stored bank authorization is deleted and Ufer asks Enable Banking to revoke it.</li>
        <li>Connecting the same bank again later continues the kept accounts instead of creating duplicates.</li>
      </ul>
      <FormError failure={error} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={pending}
          onClick={close}
        >
          Cancel
        </button>
        {/* Removal waits until the dialog can say how many accounts it keeps. */}
        <button className={styles["danger"]} disabled={pending || accounts.status === "pending"}>
          <Trash2 size={15} />
          Remove connection
        </button>
      </div>
    </form>
  );
}

function RetainedAccounts({
  accounts,
  connection
}: {
  accounts: Area<Account[]>;
  connection: Connection;
}) {
  if (accounts.status === "pending" && accounts.failure) {
    return <InlineFailure failure={accounts.failure} subject="The linked accounts" />;
  }

  if (accounts.status === "pending") {
    return (
      <>
        <strong className={ui["skeleton"]} aria-hidden="true">0 linked account(s) stay in Ufer</strong>
        <span className={ui["visually-hidden"]}>Loading the linked accounts …</span> with their balances, transaction history and categories.
      </>
    );
  }

  const linkedAccounts = accounts.data.filter(account => account.requisition_id === connection.id);

  return (
    <>
      <strong>{linkedAccounts.length} linked account(s) stay in Ufer</strong> with their balances, transaction history and categories.
    </>
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
