import { Temporal } from "temporal-polyfill";
import { dateWithYear, describeDate } from "@/lib/date-format";
import type { BalancePoint } from "./types";

export const balanceSourceLabels: Record<BalancePoint["source"], string> = {
  sync: "Bank sync",
  manual: "Manual",
  csv: "CSV import",
  transactions: "Estimated"
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
  if (balance.source !== "sync") {
    return balanceSourceLabels[balance.source];
  }

  const classification = balance.bank_balance_type ? bankBalanceLabels[balance.bank_balance_type] : undefined;

  return classification ? `Bank sync · ${classification}` : "Bank sync";
}
