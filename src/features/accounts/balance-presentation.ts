import { Temporal } from "temporal-polyfill";
import { dateWithYear, describeDate } from "@/lib/date-format";
import type { BalancePoint } from "./types";

export const balanceSourceLabels: Record<BalancePoint["source"], string> = {
  sync: "Bank sync",
  manual: "Manual",
  csv: "CSV import",
  transactions: "Calculated"
};

export function describeBalanceDate(date: string) {
  const day = Temporal.PlainDate.from(date);

  return {
    ...describeDate(day),
    label: dateWithYear(day)
  };
}
