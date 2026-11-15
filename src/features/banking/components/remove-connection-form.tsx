"use client";

import ui from "../../../components/ui/primitives.module.css";

import { Trash2 } from "lucide-react";
import styles from "./remove-connection-form.module.css";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "removeConnection" | "selectedConnection" | "setModal" | "state">;

export function RemoveConnectionForm({
  busy,
  removeConnection,
  selectedConnection,
  setModal,
  state
}: Props) {
  if (!selectedConnection || !state) {
    return null;
  }

  const linkedAccounts = state.accounts.filter(account => account.requisition_id === selectedConnection.id);

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void removeConnection(selectedConnection);
      }}
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
      <div className={ui["button-group"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={busy}
          onClick={() => setModal(null)}
        >
          Cancel
        </button>
        <button className={styles["danger"]} disabled={busy}>
          <Trash2 size={15} />
          Remove connection
        </button>
      </div>
    </form>
  );
}
