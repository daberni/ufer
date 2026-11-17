import { Temporal } from "temporal-polyfill";
import type { BalancePoint } from "./types";

export type DailyBooking = {
  date: string;
  amount_minor: number;
};

/** Reconstructs daily closing balances from one known closing balance; a partial import must never imply a zero opening balance. */
export function dailyBalances(bookings: DailyBooking[], reference: BalancePoint, endDate: string): BalancePoint[] {
  const eligible = bookings.filter(booking => booking.date <= endDate);

  if (!eligible.length) {
    return [];
  }

  const firstDate = [reference.date, ...eligible.map(booking => booking.date)].sort()[0];
  const changes = new Map<string, number>();
  let amount = reference.amount_minor;

  for (const booking of eligible) {
    changes.set(booking.date, (changes.get(booking.date) ?? 0) + booking.amount_minor);

    if (booking.date <= reference.date) {
      amount -= booking.amount_minor;
    }
  }

  const balances: BalancePoint[] = [];

  for (let date = Temporal.PlainDate.from(firstDate); date.toString() <= endDate; date = date.add({
    days: 1
  })) {
    const day = date.toString();

    amount += changes.get(day) ?? 0;
    balances.push({
      date: day,
      amount_minor: amount,
      source: day === reference.date ? reference.source : "transactions"
    });
  }

  return balances;
}
