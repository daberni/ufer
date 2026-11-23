"use client";

import { clsx } from "clsx";
import ui from "../../../components/ui/primitives.module.css";

import { useState } from "react";
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
import { useTranslations } from "next-intl";

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
  const t = useTranslations("banking");

  return (
    <Dialog eyebrow={t("eyebrow")} title={t("remove.title")} onClose={close}>
      <RemoveConnectionForm close={close} onRemoved={onRemoved} selectedConnection={selectedConnection} />
    </Dialog>
  );
}

function RemoveConnectionForm({
  close,
  onRemoved,
  selectedConnection
}: Props) {
  const t = useTranslations("banking.remove");
  const [archiveAccounts, setArchiveAccounts] = useState(false);
  const accounts = useAreaResult(useAccounts());
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useRemoveConnection(), close);

  return (
    <form
      onSubmit={event => submit(event, () => ({
        connectionId: selectedConnection.id,
        archiveAccounts
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
        <li>{t("notSynced")}</li>
        <li>{t("revokes")}</li>
        <li>{t("reconnect")}</li>
      </ul>
      <label className={clsx(ui["check-option"], styles["archive"])}>
        <input
          name="archive_accounts"
          type="checkbox"
          checked={archiveAccounts}
          onChange={event => setArchiveAccounts(event.target.checked)}
        />
        {t("archive")}
      </label>
      {archiveAccounts && <UnsettledAccounts accounts={accounts} connection={selectedConnection} />}
      <FormError failure={error} />
      <div className={ui["form-actions"]}>
        <button
          type="button"
          className={ui["button"]}
          disabled={pending}
          onClick={close}
        >
          {t("cancel")}
        </button>
        {/* Removal waits until the dialog can say how many accounts it keeps. */}
        <button className={ui["danger-button"]} disabled={pending || accounts.status === "pending"}>
          <Trash2 size={15} />
          {t("submit")}
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
  const t = useTranslations("banking.remove");

  if (accounts.status === "pending" && accounts.failure) {
    return <InlineFailure failure={accounts.failure} failureTitle={t("linkedFailed")} />;
  }

  if (accounts.status === "pending") {
    return (
      <>
        <strong className={ui["skeleton"]} aria-hidden="true">{t("linkedPlaceholder")}</strong>
        {" "}
        {t.rich("linkedLoading", {
          hidden: chunks => <span className={ui["visually-hidden"]}>{chunks}</span>
        })}
      </>
    );
  }

  const linkedAccounts = accounts.data.filter(account => account.requisition_id === connection.id);

  return t.rich("retained", {
    count: linkedAccounts.length,
    strong: chunks => <strong>{chunks}</strong>
  });
}

// Archiving needs a balance of 0; the others stay active after removal.
function UnsettledAccounts({
  accounts,
  connection
}: {
  accounts: Area<Account[]>;
  connection: Connection;
}) {
  const t = useTranslations("banking.remove");
  // An account without bookings has a balance of 0 and is archived like the server does.
  const unsettled = accounts.data?.filter(account => account.requisition_id === connection.id && (account.balance_minor ?? 0) !== 0) ?? [];

  if (!unsettled.length) {
    return null;
  }

  return (
    <p className={ui["form-hint"]}>{t("unsettled", {
      accounts: unsettled.map(account => account.name).join(", ")
    })}</p>
  );
}
