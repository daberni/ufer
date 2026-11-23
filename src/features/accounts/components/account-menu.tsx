"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Temporal } from "temporal-polyfill";
import { Archive, ArchiveRestore, ArrowRight, Link2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toFailure } from "@/client/api";
import { ActionFeedback } from "@/components/ui/action-feedback";
import { ActionMenu, MenuItem, MenuLink } from "@/components/ui/action-menu";
import { accountProblem } from "@/features/accounts/account-presentation";
import { useArchiveAccount, useRestoreAccount } from "@/features/accounts/mutations";
import { BankConnectionDialog } from "@/features/banking/components/bank-connection-form";
import { bankConnectionsHref } from "@/features/banking/connections-location";
import { useConnections } from "@/features/banking/queries";
import type { Account } from "@/features/accounts/types";
import { CloseAccountDialog } from "./close-account-dialog";
import { DeleteAccountDialog } from "./account-removal-dialogs";
import { EditAccountDialog } from "./edit-account-dialog";

type Dialog = "edit" | "reconnect" | "connect" | "close" | "delete" | null;

/**
 * The account's actions beside its page heading. Reconnecting appears only while no problem notice offers it, and the bank connections link only for an
 * account without a known connection. An active manual account can be connected to a bank; deleting needs an account without a connection; archiving needs a balance of 0 or a closing.
 */
export function AccountMenu({
  account,
  addTransaction,
  addLabel
}: {
  account: Account;
  /** Offered as the first entry on phones, where the heading shows no separate "Add transaction" button. */
  addTransaction?: () => void;
  addLabel?: string;
}) {
  const t = useTranslations("accounts.menu");
  const [dialog, setDialog] = useState<Dialog>(null);
  const archive = useArchiveAccount(account.id);
  const restore = useRestoreAccount(account.id);
  const connections = useConnections().data ?? [];
  const close = () => setDialog(null);
  const archived = account.archived_at !== null;
  const bankLinked = account.provider !== "manual";
  // A brokerage account holds securities: it connects to no bank and is archived once nothing is held, never closed by booking its value away.
  const brokerage = account.kind === "brokerage";
  const detached = account.requisition_id === null;
  const connection = connections.find(item => item.id === account.requisition_id) ?? null;
  const offersReconnect = connection !== null && !archived && accountProblem(account, Temporal.Now.instant()) === null;
  // An account without bookings has a balance of 0.
  const settled = (account.balance_minor ?? 0) === 0;
  const error = archive.error ?? restore.error;
  const failure = error ? toFailure(error) : null;

  return (
    <>
      <ActionMenu
        label={t("label", {
          name: account.name
        })}
        appearance="button"
      >
        {addTransaction && (
          <MenuItem icon={<Plus size={15} aria-hidden="true" />} phoneOnly onSelect={addTransaction}>
            {addLabel ?? t("addTransaction")}
          </MenuItem>
        )}
        <MenuItem icon={<Pencil size={15} aria-hidden="true" />} onSelect={() => setDialog("edit")}>
          {t("edit")}
        </MenuItem>
        {offersReconnect && (
          <MenuItem icon={<RefreshCw size={15} aria-hidden="true" />} onSelect={() => setDialog("reconnect")}>
            {t("reconnect")}
          </MenuItem>
        )}
        {bankLinked && !connection && (
          <MenuLink icon={<ArrowRight size={15} aria-hidden="true" />} href={bankConnectionsHref}>
            {t("manageConnections")}
          </MenuLink>
        )}
        {!bankLinked && !brokerage && !archived && (
          <MenuItem icon={<Link2 size={15} aria-hidden="true" />} onSelect={() => setDialog("connect")}>
            {t("connect")}
          </MenuItem>
        )}
        {archived ? (
          <MenuItem icon={<ArchiveRestore size={15} aria-hidden="true" />} disabled={restore.isPending} onSelect={() => restore.mutate()}>
            {t("restore")}
          </MenuItem>
        ) : (
          <MenuItem icon={<Archive size={15} aria-hidden="true" />} disabled={archive.isPending} onSelect={() => settled || brokerage ? archive.mutate({}) : setDialog("close")}>
            {t("archive")}
          </MenuItem>
        )}
        {detached && (
          <MenuItem icon={<Trash2 size={15} aria-hidden="true" />} danger onSelect={() => setDialog("delete")}>
            {t("delete")}
          </MenuItem>
        )}
      </ActionMenu>
      <ActionFeedback
        feedback={failure && dialog === null ? {
          tone: "problem",
          messages: [failure.message],
          traceId: failure.traceId
        } : null}
        dismissLabel={t("dismiss")}
        onDismiss={() => {
          archive.reset();
          restore.reset();
        }}
        placement="overlay"
      />
      {dialog === "edit" && <EditAccountDialog account={account} close={close} />}
      {dialog === "reconnect" && connection && <BankConnectionDialog connection={connection} close={close} />}
      {dialog === "close" && <CloseAccountDialog account={account} close={close} />}
      {dialog === "connect" && <BankConnectionDialog connection={null} account={account} close={close} />}
      {dialog === "delete" && <DeleteAccountDialog account={account} close={close} />}
    </>
  );
}
