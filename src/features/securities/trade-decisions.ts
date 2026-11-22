import { ValidationError } from "@/lib/errors";
import type { TradeSide } from "./trade-sides";

/** Days a bank booking may lie before or after its trade date to be its cash side, as for linking transfers. */
export const settlementWindowDays = 14;

export type TradeAmounts = {
  side: TradeSide;
  gross_minor: number;
  fee_minor: number;
  tax_minor: number;
};

/** The signed cash movement on the settlement account: a buy pays its gross amount, fees and taxes; a sale receives its gross amount less fees and taxes. */
export function tradeCashAmount(trade: TradeAmounts) {
  const amount = trade.side === "buy" ? -(trade.gross_minor + trade.fee_minor + trade.tax_minor) : trade.gross_minor - trade.fee_minor - trade.tax_minor;

  if (amount === 0) {
    throw new ValidationError("A trade must move cash on the settlement account.");
  }

  return amount;
}

export type SettlementBooking = {
  account_provider: string;
  account_kind: string;
  account_archived_at: string | null;
  date: string;
  amount_minor: number;
  currency: string;
  transfer_id: string | null;
  suppressed_at: string | null;
  trade_leg: number;
  split: number;
};

export type SettlementRefusal = "not_bank_booking" | "archived_account" | "currency_mismatch" | "amount_mismatch" | "linked" | "hidden" | "split" | "outside_window";

/** Whether an imported bank booking can become the cash side of a trade; the bank booking stays the source of truth for its amount and date. */
export function settlementRefusal(booking: SettlementBooking, expected: {
  amount_minor: number;
  currency: string;
  daysApart: number;
}): SettlementRefusal | null {
  if (booking.account_provider === "manual" || booking.account_kind === "brokerage") {
    return "not_bank_booking";
  }

  if (booking.account_archived_at !== null) {
    return "archived_account";
  }

  if (booking.currency !== expected.currency) {
    return "currency_mismatch";
  }

  if (booking.amount_minor !== expected.amount_minor) {
    return "amount_mismatch";
  }

  if (booking.transfer_id !== null || booking.trade_leg) {
    return "linked";
  }

  if (booking.suppressed_at !== null) {
    return "hidden";
  }

  if (booking.split) {
    return "split";
  }

  if (Math.abs(expected.daysApart) > settlementWindowDays) {
    return "outside_window";
  }

  return null;
}
