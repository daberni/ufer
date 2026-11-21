import { Temporal } from "temporal-polyfill";
import { normalizeText } from "./text";

// Matches bookings that record the same movement from different sources: a CSV import against stored bookings, or a bank delivery against imported rows.

/** Days a booking date may differ between duplicates: banks and exports disagree between booking and value date, and weekends shift bookings by up to three days. */
export const duplicateDateToleranceDays = 3;

/** Every date a booking is recorded on: its date and, for a bank booking, the bank's booking date. */
export function bookingDays(booking: Pick<Booking, "date" | "bookingDate">) {
  return booking.bookingDate && booking.bookingDate !== booking.date ? [booking.date, booking.bookingDate] : [booking.date];
}

/** Whether two bookings share any recorded date. */
export function sameDay(left: Pick<Booking, "date" | "bookingDate">, right: Pick<Booking, "date" | "bookingDate">) {
  const rightDays = bookingDays(right);

  return bookingDays(left).some(day => rightDays.includes(day));
}

/** The fewest days between any recorded dates of two bookings. */
export function bookingDistance(left: Pick<Booking, "date" | "bookingDate">, right: Pick<Booking, "date" | "bookingDate">) {
  const rightDays = bookingDays(right);

  return Math.min(...bookingDays(left).flatMap(day => rightDays.map(other => dayDistance(day, other))));
}

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
  /** A bank booking's own booking date next to its value date in `date`; other sources may record either date, so both count. */
  bookingDate?: string | null;
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
 * The booking that records the same movement as `candidate`: exactly the same amount and matching text, sharing a recorded date (see `bookingDays`), or else the only such booking at most `duplicateDateToleranceDays` apart.
 * Several bookings within the window are "ambiguous" and match none; -1 means no match.
 */
export function matchBooking<T extends Booking>(candidate: PreparedBooking<Booking>, prepared: PreparedBookings<T>, available: (index: number) => boolean): number | "ambiguous" {
  const fits = sameAmountInWindow(candidate, prepared, available).filter(index => textsMatch(prepared.bookings[index], candidate));
  const sharing = fits.filter(index => sameDay(prepared.bookings[index], candidate));

  // Bookings on the very same date are interchangeable, so the first one matches; a date shared only through a bank booking date may belong to either booking.
  if (sharing.length > 1 && sharing.some(index => bookingDays(prepared.bookings[index]).length > 1 || bookingDays(candidate).length > 1)) {
    return "ambiguous";
  }

  if (sharing.length > 0) {
    return sharing[0];
  }

  if (fits.length > 1) {
    return "ambiguous";
  }

  return fits[0] ?? -1;
}

export function sameAmountInWindow<T extends Booking>(candidate: Booking, prepared: PreparedBookings<T>, available: (index: number) => boolean) {
  const indices = prepared.byAmount.get(candidate.amount) ?? [];

  return indices.filter(index => available(index) && bookingDistance(prepared.bookings[index], candidate) <= duplicateDateToleranceDays);
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
