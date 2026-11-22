import type { TransactionType } from "@/lib/transaction-types";

/** What a manual balance records: an opening balance for an account without bookings, otherwise an adjustment for the difference; null books nothing. */
export type ManualBalanceBooking = {
  type: Extract<TransactionType, "opening_balance" | "adjustment">;
  amount: number;
};

/**
 * Decides how `amount` becomes a manual account's balance at the end of a date, given its visible bookings.
 * `onDate` is the sum of the visible bookings dated on or before that date, so later bookings keep their effect.
 */
export function decideManualBalance(booked: {
  count: number;
  onDate: number;
}, amount: number): ManualBalanceBooking | null {
  if (booked.count === 0) {
    return {
      type: "opening_balance",
      amount
    };
  }

  const difference = amount - booked.onDate;

  if (difference === 0) {
    return null;
  }

  return {
    type: "adjustment",
    amount: difference
  };
}
