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

/** Whether a bank-linked account's bookings need an adjustment to match its newest reported balance. */
export type ReconciliationDecision = "not_reported" | "matches" | "adjust";

/** Only a reported booked balance of a comparable type can be matched; a total that already equals it books nothing. */
export function decideReconciliation(reported: {
  amount: number;
  type: string | null;
} | null, bookedTotal: number, comparableTypes: readonly string[]): ReconciliationDecision {
  if (!reported?.type || !comparableTypes.includes(reported.type)) {
    return "not_reported";
  }

  return bookedTotal === reported.amount ? "matches" : "adjust";
}

/** How a manual account's remaining balance is booked away on closing, or why the closing is refused. */
export type ClosingDecision = {
  refused: "balance_changed";
} | {
  refused: "before_last_booking";
  lastBooking: string;
} | {
  refused?: undefined;
  amount: number;
  type: Extract<TransactionType, "transfer" | "adjustment">;
};

/**
 * Decides the closing booking for a manual account: the confirmed balance must still be the booked total, and the closing date may not precede the last booking, which would leave activity after the account reached 0.
 * The remaining balance is booked away as a transfer when a target account is chosen, otherwise as an adjustment.
 */
export function decideClosing(booked: {
  amount: number;
  latest: string | null;
}, expectedBalance: number, date: string, transfers: boolean): ClosingDecision {
  if (booked.amount !== expectedBalance) {
    return {
      refused: "balance_changed"
    };
  }

  if (booked.latest && date < booked.latest) {
    return {
      refused: "before_last_booking",
      lastBooking: booked.latest
    };
  }

  return {
    amount: -expectedBalance,
    type: transfers ? "transfer" : "adjustment"
  };
}
