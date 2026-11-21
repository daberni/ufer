import { Temporal } from "temporal-polyfill";
import { normalizeText } from "./text";

// Matches bookings that record the same movement from different sources: a CSV import against stored bookings, or a bank delivery against imported rows.

/** Days a booking date may differ between duplicates: banks and exports disagree between booking and value date, and weekends shift bookings by up to three days. */
export const duplicateDateToleranceDays = 3;

/** The booking dates that may hold a match for any of these dates, which must be sorted and not empty. */
export function matchingWindow(sortedDates: string[]) {
  return {
    from: shiftDays(sortedDates[0], -duplicateDateToleranceDays),
    to: shiftDays(sortedDates[sortedDates.length - 1], duplicateDateToleranceDays)
  };
}

function shiftDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({
    days
  }).toString();
}

/** The fields that identify one movement across sources. */
export type Booking = {
  date: string;
  amount: number;
  counterparty: string;
  description: string;
};

export type PreparedBooking<T extends Booking> = T & {
  text: string;
  words: Set<string>;
};

/** Bookings with their normalized texts, indexed by amount, so matching a file compares only bookings of the same amount and normalizes each text once. */
export type PreparedBookings<T extends Booking> = {
  bookings: PreparedBooking<T>[];
  byAmount: Map<number, number[]>;
};

export function prepareBookings<T extends Booking>(bookings: T[]): PreparedBookings<T> {
  const prepared = bookings.map(prepareBooking);
  const byAmount = new Map<number, number[]>();

  prepared.forEach((booking, index) => {
    const indices = byAmount.get(booking.amount) ?? [];

    indices.push(index);
    byAmount.set(booking.amount, indices);
  });

  return {
    bookings: prepared,
    byAmount
  };
}

export function prepareBooking<T extends Booking>(booking: T): PreparedBooking<T> {
  const text = normalizeText(`${booking.counterparty} ${booking.description}`);

  return {
    ...booking,
    text,
    words: new Set(text.split(" ").filter(word => word.length >= 4))
  };
}

/**
 * The booking that records the same movement as `candidate`: exactly the same amount and matching text, on the same booking date, or else the only such booking at most `duplicateDateToleranceDays` apart.
 * Several bookings within the window are "ambiguous" and match none; -1 means no match.
 */
export function matchBooking<T extends Booking>(candidate: PreparedBooking<Booking>, prepared: PreparedBookings<T>, available: (index: number) => boolean): number | "ambiguous" {
  const fits = sameAmountInWindow(candidate, prepared, available).filter(index => textsMatch(prepared.bookings[index], candidate));
  const sameDate = fits.find(index => prepared.bookings[index].date === candidate.date);

  if (sameDate !== undefined) {
    return sameDate;
  }

  if (fits.length > 1) {
    return "ambiguous";
  }

  return fits[0] ?? -1;
}

export function sameAmountInWindow<T extends Booking>(candidate: Booking, prepared: PreparedBookings<T>, available: (index: number) => boolean) {
  const indices = prepared.byAmount.get(candidate.amount) ?? [];

  return indices.filter(index => available(index) && dayDistance(prepared.bookings[index].date, candidate.date) <= duplicateDateToleranceDays);
}

export function textsMatch(left: Pick<PreparedBooking<Booking>, "text" | "words">, right: Pick<PreparedBooking<Booking>, "text" | "words">) {
  if (!left.text || !right.text) {
    return false;
  }

  if (left.text.includes(right.text) || right.text.includes(left.text)) {
    return true;
  }

  for (const word of right.words) {
    if (left.words.has(word)) {
      return true;
    }
  }

  return false;
}

export function dayDistance(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}
