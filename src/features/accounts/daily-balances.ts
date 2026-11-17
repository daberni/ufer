import { Temporal } from "temporal-polyfill";
import type { BalancePoint } from "./types";

export type DailyBooking = {
  date: string;
  amount_minor: number;
};

// Retain recent daily detail without expanding centuries of unchanged history from an imported date.
const dailyHistoryDays = 3660;

/** Estimates balances from bookings, keeping recent days and every older change or recorded observation. */
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

  const dates = new Set([firstDate, endDate, ...changes.keys(), ...actual.keys()]);
  const recentStart = Temporal.PlainDate.from(endDate).subtract({
    days: dailyHistoryDays - 1
  }).toString();
  const dailyStart = firstDate > recentStart ? firstDate : recentStart;

  for (let date = Temporal.PlainDate.from(dailyStart); date.toString() <= endDate; date = date.add({
    days: 1
  })) {
    dates.add(date.toString());
  }

  const balances: BalancePoint[] = [];

  // Every booking and observation date remains, so skipped flat stretches retain their exact step value.
  for (const day of [...dates].sort()) {
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
