import { Temporal } from "temporal-polyfill";
import { dateWithYear, describeDate } from "@/lib/date-format";
import type { BalancePoint } from "./types";

// A balance is either the running sum of an account's bookings or, for a brokerage account, the market value of its holdings.
export const balanceSourceLabels: Record<BalancePoint["source"], string> = {
  transactions: "From bookings",
  valuation: "Market value"
};

export function describeBalanceDate(date: string, locale: string) {
  const day = Temporal.PlainDate.from(date);

  return {
    ...describeDate(day, locale),
    label: dateWithYear(day, locale)
  };
}


const bankBalanceLabels: Record<string, string> = {
  CLBD: "Closing booked",
  ITBD: "Interim booked",
  CLAV: "Closing available",
  ITAV: "Interim available",
  PRCD: "Previous closing booked",
  XPCD: "Expected"
};

/** The bank's classification of a reported balance, such as "Closing booked". */
export function describeBankBalanceType(type: string | null) {
  return type ? bankBalanceLabels[type] ?? type : "Reported";
}

export function describeBalanceSource(balance: BalancePoint) {
  return balanceSourceLabels[balance.source];
}
