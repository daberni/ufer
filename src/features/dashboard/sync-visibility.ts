import type { View } from "@/client/app-location";
import type { Account } from "@/features/accounts/types";

/** Whether the page heading offers the sync control: not while importing, and on account details only for an active bank account, since archived accounts are not synced. */
export function showsSync(view: View, selectedAccount: Pick<Account, "provider" | "archived_at"> | undefined) {
  if (view === "import") {
    return false;
  }

  if (view !== "account") {
    return true;
  }

  return Boolean(selectedAccount && selectedAccount.provider !== "manual" && selectedAccount.archived_at === null);
}
