import type { View } from "@/client/app-location";
import type { Account } from "@/features/accounts/types";

/** Whether the page heading offers the sync control: not while importing, and on account details only for an active, connected bank account, since archived and detached accounts are not synced. */
export function showsSync(view: View, selectedAccount: Pick<Account, "provider" | "archived_at" | "requisition_id"> | undefined) {
  if (view === "import") {
    return false;
  }

  if (view !== "account") {
    return true;
  }

  // A bank account detached by removing its connection has nothing to sync until it is reconnected.
  return Boolean(selectedAccount && selectedAccount.provider !== "manual" && selectedAccount.archived_at === null && selectedAccount.requisition_id !== null);
}
