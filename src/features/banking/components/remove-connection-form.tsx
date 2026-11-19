"use client";

import ui from "../../../components/ui/primitives.module.css";

import { Trash2 } from "lucide-react";
import styles from "./remove-connection-form.module.css";
import { FormError } from "@/components/ui/form-error";
import type { Account } from "@/features/accounts/types";
import type { Connection, ConnectionRemoval } from "@/features/banking/types";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useRemoveConnection } from "@/features/banking/mutations";
import { useAccounts } from "@/features/accounts/queries";
import { InlineFailure } from "@/components/ui/area-placeholder";
import { useAreaResult, type Area } from "@/components/ui/use-area-result";
import { Dialog } from "@/components/ui/dialog";

type Props = DialogFormProps & {
  selectedConnection: Connection;
  /** Called after removal with the accounts that stayed active although archiving was chosen. */
  onRemoved?: (removal: ConnectionRemoval) => void;
};

export function RemoveConnectionDialog({
  close,
  onRemoved,
  selectedConnection
}: Props) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Remove connection" onClose={close}>
      <RemoveConnectionForm close={close} onRemoved={onRemoved} selectedConnection={selectedConnection} />
    </Dialog>
  );
}

function RemoveConnectionForm({
  close,
  onRemoved,
  selectedConnection
}: Props) {
  const accounts = useAreaResult(useAccounts());
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useRemoveConnection(), close);

  return (
    <form
      onSubmit={event => submit(event, data => ({
        connectionId: selectedConnection.id,
        archiveAccounts: data.get("archive_accounts") === "on"
      }), onRemoved)}
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
        <li>Ufer revokes the bank authorization before removing the connection. If that fails, the connection stays and you can try again.</li>
        <li>Connecting the same bank again later continues the kept accounts instead of creating duplicates.</li>
      </ul>
      <label className={styles["archive"]}>
        <input name="archive_accounts" type="checkbox" />
        Archive these accounts: hide them from the account lists and pickers, keep them in reports, restore them any time
      </label>
      <UnsettledAccounts accounts={accounts} connection={selectedConnection} />
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

// Archiving needs a balance of 0; the others stay active after removal.
function UnsettledAccounts({
  accounts,
  connection
}: {
  accounts: Area<Account[]>;
  connection: Connection;
}) {
  const unsettled = accounts.data?.filter(account => account.requisition_id === connection.id && (account.balance_minor ?? 0) !== 0) ?? [];

  if (!unsettled.length) {
    return null;
  }

  return <p className={ui["form-hint"]}>Only accounts with a balance of 0 are archived. These stay active: {unsettled.map(account => account.name).join(", ")}.</p>;
}
