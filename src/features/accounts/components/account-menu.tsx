"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ArrowRight, PenLine, RefreshCw, Trash2 } from "lucide-react";
import { ActionMenu, MenuItem, MenuLink } from "@/components/ui/action-menu";
import type { useArchiveAccount, useRestoreAccount } from "@/features/accounts/mutations";
import { bankConnectionsHref } from "@/features/banking/connections-location";
import type { Account } from "@/features/accounts/types";
import type { Connection } from "@/features/banking/types";
import { CloseAccountDialog } from "./close-account-dialog";
import { ConvertAccountDialog, DeleteAccountDialog } from "./account-removal-dialogs";

type Dialog = "close" | "convert" | "delete" | null;

/**
 * The account's rarely used actions. Reconnecting appears here only while no problem notice offers it; converting and deleting apply only to accounts
 * without a bank connection, and archiving needs a balance of 0 or a closing.
 */
export function AccountMenu({
  account,
  archive,
  restore,
  reconnect
}: {
  account: Account;
  /** Owned by the summary, which shows their failures below its header. */
  archive: ReturnType<typeof useArchiveAccount>;
  restore: ReturnType<typeof useRestoreAccount>;
  /** The connection to reauthorize from the menu, if the account has one and no notice already offers it. */
  reconnect: {
    connection: Connection;
    open: () => void;
  } | null;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const archived = account.archived_at !== null;
  const bankLinked = account.provider !== "manual";
  const detached = account.requisition_id === null;
  // An account without bookings has a balance of 0.
  const settled = (account.balance_minor ?? 0) === 0;

  return (
    <>
      <ActionMenu label={`Actions for ${account.name}`}>
        {reconnect && (
          <MenuItem icon={<RefreshCw size={15} aria-hidden="true" />} onSelect={reconnect.open}>
            Reconnect {reconnect.connection.bank_name}
          </MenuItem>
        )}
        {bankLinked && (
          <MenuLink icon={<ArrowRight size={15} aria-hidden="true" />} href={bankConnectionsHref}>
            Manage bank connections
          </MenuLink>
        )}
        {bankLinked && detached && (
          <MenuItem icon={<PenLine size={15} aria-hidden="true" />} onSelect={() => setDialog("convert")}>
            Convert to manual account
          </MenuItem>
        )}
        {archived ? (
          <MenuItem icon={<ArchiveRestore size={15} aria-hidden="true" />} disabled={restore.isPending} onSelect={() => restore.mutate()}>
            Restore account
          </MenuItem>
        ) : (
          <MenuItem icon={<Archive size={15} aria-hidden="true" />} disabled={archive.isPending} onSelect={() => settled ? archive.mutate({}) : setDialog("close")}>
            Archive account
          </MenuItem>
        )}
        {detached && (
          <MenuItem icon={<Trash2 size={15} aria-hidden="true" />} danger onSelect={() => setDialog("delete")}>
            Delete account
          </MenuItem>
        )}
      </ActionMenu>
      {dialog === "close" && <CloseAccountDialog account={account} close={close} />}
      {dialog === "convert" && <ConvertAccountDialog account={account} close={close} />}
      {dialog === "delete" && <DeleteAccountDialog account={account} close={close} />}
    </>
  );
}
