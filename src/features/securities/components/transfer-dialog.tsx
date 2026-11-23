"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./transfer-dialog.module.css";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { toFailure } from "@/client/api";
import { useLocale } from "@/client/locale-provider";
import { money } from "@/lib/money";
import { today } from "@/lib/time";
import type { Account } from "@/features/accounts/types";
import { useCorrectTransfer, useDeleteTransfer, useRecordTransfer } from "../mutations";
import type { Holding, Trade } from "../types";
import { formatQuantity } from "./holding-format";

/** Plain decimal shares for an input, without grouping, so the value can be sent back unchanged. */
function sharesText(quantityMicros: number) {
  const whole = Math.trunc(quantityMicros / 1_000_000);
  const fraction = String(quantityMicros % 1_000_000).padStart(6, "0").replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Moves shares of a holding to another brokerage account without a sale, for example when a depot moves to another broker. The receiving account takes over their cost basis, and no gain is realized.
 */
export function TransferDialog({
  account,
  holding,
  brokerageAccounts,
  close
}: {
  account: Account;
  holding: Holding;
  brokerageAccounts: Account[];
  close: () => void;
}) {
  const t = useTranslations("securities");
  const locale = useLocale();
  const receivers = brokerageAccounts.filter(item => item.id !== account.id && item.currency === account.currency && item.archived_at === null);
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useRecordTransfer(), close);

  return (
    <Dialog
      eyebrow={t("tradeForm.eyebrow")}
      title={t("transfer.title", {
        security: holding.security_name
      })}
      onClose={close}
    >
      {receivers.length ? (
        <form
          className={ui["form"]}
          onSubmit={event => submit(event, data => ({
            accountId: account.id,
            security_id: holding.security_id,
            to_account_id: String(data.get("to_account_id")),
            date: String(data.get("date")),
            quantity: String(data.get("quantity")).trim()
          }))}
        >
          <p className={ui["form-description"]}>
            {t("transfer.description", {
              account: account.name,
              costBasis: money(holding.cost_minor, account.currency, locale),
              quantity: formatQuantity(holding.quantity_micros, locale)
            })}
          </p>
          <label>
            {t("transfer.toAccount")}
            <Select name="to_account_id" required autoFocus>
              {receivers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
          <TransferFields quantity={sharesText(holding.quantity_micros)} date={today().toString()} />
          <FormError failure={error} />
          <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
            {t("transfer.submit")} <Check size={16} />
          </button>
        </form>
      ) : (
        <p className={ui["form-description"]}>{t("transfer.noReceiver", {
          currency: account.currency
        })}</p>
      )}
    </Dialog>
  );
}

function TransferFields({
  quantity,
  date
}: {
  quantity: string;
  date: string;
}) {
  const t = useTranslations("securities.transfer");

  return (
    <div className={styles["fields"]}>
      <label>
        {t("shares")}
        <input
          name="quantity"
          required
          inputMode="decimal"
          defaultValue={quantity}
        />
      </label>
      <label>
        {t("date")}
        <input
          name="date"
          type="date"
          required
          defaultValue={date}
          max={today().toString()}
        />
      </label>
    </div>
  );
}

/** Corrects or removes a recorded transfer from either account's trade history. */
export function TransferEditDialog({
  trade,
  accountName,
  close
}: {
  trade: Trade;
  accountName: string;
  close: () => void;
}) {
  const t = useTranslations("securities.transfer");
  const locale = useLocale();
  const [removing, setRemoving] = useState(false);
  const remove = useDeleteTransfer();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useCorrectTransfer(), close);
  const counterpart = trade.transfer?.counterpart_account_name ?? t("anotherAccount");
  const [from, to] = trade.side === "transfer_out" ? [accountName, counterpart] : [counterpart, accountName];

  return (
    <Dialog
      eyebrow={t("eyebrow")}
      title={t("editTitle", {
        security: trade.security_name
      })}
      onClose={close}
    >
      <p className={ui["form-description"]}>
        {t("route", {
          from,
          to,
          costBasis: money(trade.gross_minor, trade.currency, locale)
        })}
      </p>
      {removing ? (
        <div className={ui["form"]}>
          <p className={ui["form-description"]}>{t("deleteEffect", {
            from
          })}</p>
          <FormError failure={remove.error ? toFailure(remove.error) : null} />
          <div className={ui["button-group"]}>
            <button
              type="button"
              className={ui["button"]}
              onClick={() => setRemoving(false)}
              disabled={remove.isPending}
            >{t("back")}</button>
            <button
              type="button"
              className={ui["danger-button"]}
              disabled={remove.isPending}
              onClick={() => remove.mutate(trade.id, {
                onSuccess: close
              })}
            >{t("deleteConfirm")}</button>
          </div>
        </div>
      ) : (
        <form
          className={ui["form"]}
          onSubmit={event => submit(event, data => ({
            transferId: trade.id,
            date: String(data.get("date")),
            quantity: String(data.get("quantity")).trim()
          }))}
        >
          <TransferFields quantity={sharesText(trade.quantity_micros)} date={trade.date} />
          <FormError failure={error} />
          <div className={ui["button-group"]}>
            <button
              type="button"
              className={ui["danger-button"]}
              onClick={() => setRemoving(true)}
              disabled={pending}
            >{t("delete")}</button>
            <button className={clsx(ui["button"], ui["primary"])} disabled={pending}>
              {t("save")} <Check size={16} />
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
