import { Temporal } from "temporal-polyfill";
import { dateWithYear, describeDate } from "@/lib/date-format";

export function describeBalanceDate(date: string, locale: string) {
  const day = Temporal.PlainDate.from(date);

  return {
    ...describeDate(day, locale),
    label: dateWithYear(day, locale)
  };
}

/** The bank balance types with a translated label, such as "Closing booked" for CLBD; other codes are shown as reported. */
export const knownBankBalanceTypes = ["CLBD", "ITBD", "CLAV", "ITAV", "PRCD", "XPCD"] as const;

export type KnownBankBalanceType = (typeof knownBankBalanceTypes)[number];

export function isKnownBankBalanceType(type: string): type is KnownBankBalanceType {
  return (knownBankBalanceTypes as readonly string[]).includes(type);
}
