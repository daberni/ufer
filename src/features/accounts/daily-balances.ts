import { Temporal } from "temporal-polyfill";
import type { BalancePoint } from "./types";

export type DailyBooking = {
  date: string;
  amount_minor: number;
};

/** Estimates missing daily balances from bookings while retaining every recorded observation on its date. */
export function dailyBalances(bookings: DailyBooking[], observations: BalancePoint[], endDate: string): BalancePoint[] {
  const eligible = bookings.filter(booking => booking.date <= endDate);

  if (!eligible.length) {
    return [];
  }

  const recorded = observations.filter(observation => observation.date <= endDate).toSorted((left, right) => left.date.localeCompare(right.date));
  const reference = recorded[0];

  if (!reference) {
    return [];
  }

  const actual = new Map(recorded.map(observation => [observation.date, observation]));
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
    const observed = actual.get(day);

    if (observed) {
      amount = observed.amount_minor;
    }

    balances.push({
      date: day,
      amount_minor: amount,
      source: observed?.source ?? "transactions"
    });
  }

  return balances;
}
