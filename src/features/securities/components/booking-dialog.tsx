"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, toFailure } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { TransactionEditDialog } from "@/features/transactions/components/transaction-edit-dialog";
import type { Transaction } from "@/features/transactions/types";

/** Opens a trade's booking from the depot in the same dialog the transaction list uses; the trade is changed there. */
export function BookingDialog({
  transactionId,
  depotId,
  close
}: {
  transactionId: string;
  /** The depot whose page opened the dialog; omitted elsewhere, such as on the Brokerage overview. */
  depotId?: string;
  close: () => void;
}) {
  const t = useTranslations("securities.booking");
  const booking = useQuery({
    queryKey: [...queryKeys.transactions.all(), "booking", transactionId],
    queryFn: ({ signal }) => apiGet<Transaction>(`transactions/${encodeURIComponent(transactionId)}`, undefined, signal)
  });

  if (booking.data) {
    return <TransactionEditDialog transaction={booking.data} depotId={depotId} close={close} />;
  }

  return (
    <Dialog eyebrow={t("title")} title={t("title")} onClose={close}>
      {booking.isError ? <FormError failure={toFailure(booking.error)} /> : <p aria-busy="true">{t("loading")}</p>}
    </Dialog>
  );
}
