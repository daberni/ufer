"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, toFailure } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { TransactionEditDialog } from "@/features/transactions/components/transaction-edit-dialog";
import type { Transaction } from "@/features/transactions/types";

/** Opens a trade's booking from the depot in the same dialog the transaction list uses; the trade is changed there. */
export function BookingDialog({
  transactionId,
  close
}: {
  transactionId: string;
  close: () => void;
}) {
  const booking = useQuery({
    queryKey: [...queryKeys.transactions.all(), "booking", transactionId],
    queryFn: ({ signal }) => apiGet<Transaction>(`transactions/${encodeURIComponent(transactionId)}`, undefined, signal)
  });

  if (booking.data) {
    return <TransactionEditDialog transaction={booking.data} close={close} />;
  }

  return (
    <Dialog eyebrow="TRANSACTION" title="Booking" onClose={close}>
      {booking.isError ? <FormError failure={toFailure(booking.error)} /> : <p aria-busy="true">Loading the booking…</p>}
    </Dialog>
  );
}
