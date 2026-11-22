import type { DuplicateReason } from "../reimport-decisions";
import { bookingDistance, matchBooking, sameDay, textsMatch, prepareBooking, prepareBookings, sameAmountInWindow, type Booking, type PreparedBooking, type PreparedBookings } from "@/lib/booking-matching";

export type ImportCandidate = {
  reference: string;
  date: string;
  amount: number;
  counterparty: string;
  description: string;
};

export type ExistingBooking = {
  /** The stored booking's ID, which decisions name. */
  id?: string;
  reference: string;
  date: string;
  bookingDate?: string | null;
  amount: number;
  counterparty: string;
  description: string;
  /** Whether the booking is a transfer between own accounts; each side's source names it differently, so its text rarely matches. */
  transfer: boolean;
};


/**
 * Finds the imported rows an account already contains. A row is a duplicate when the account has a booking with the same reference, or otherwise a booking `matchBooking` finds, whatever source saved it, including an earlier import of another file.
 * Rows with several matching bookings in the date window, or with a booking of the same amount that only the date or a transfer suggests, are returned as `possible` duplicates with their candidate bookings; the person decides what they do.
 * Each existing booking absorbs at most one row. `consumed` lists the bookings earlier batches of this import matched or saved, so a batch never mistakes rows of its own file for duplicates, genuine repeats beyond the existing ones still import and a check reports what confirming saves.
 */
export function findDuplicates<T extends ExistingBooking>(candidates: ImportCandidate[], existing: T[], consumed: ReadonlySet<string> = new Set(), expected: ReadonlyMap<number, string> = new Map(), created: ReadonlySet<number> = new Set()) {
  const duplicates = new Map<number, DuplicateReason>();
  const matched: Pick<ExistingBooking, "reference" | "date">[] = [];
  const possible: number[] = [];
  /** Rows whose content match is not the booking their decision names. */
  const stale: number[] = [];
  /** The booking each duplicate row matched. */
  const matches = new Map<number, T>();
  /** The bookings each possible duplicate may record, in order of preference. */
  const candidatesOf = new Map<number, T[]>();
  const references = new Map(existing.map(booking => [booking.reference, booking]));
  const candidateReferences = new Set(candidates.map(candidate => candidate.reference));
  const available = prepareBookings(existing.filter(booking => !consumed.has(booking.reference) && !candidateReferences.has(booking.reference)));
  const used = new Set<number>();
  const isFree = (index: number) => !used.has(index);

  candidates.forEach((candidate, index) => {
    const imported = references.get(candidate.reference);

    if (imported !== undefined) {
      duplicates.set(index, "already_imported");
      matches.set(index, imported);
      // A retried import passes its earlier rows back as consumed too, so they never absorb a neighbouring row of a later batch by content.
      matched.push({
        reference: candidate.reference,
        date: imported.date
      });

      return;
    }

    const prepared = prepareBooking(candidate);
    const match = matchBooking(prepared, available, isFree);

    if (match === "ambiguous" || (match < 0 && hasWeakMatch(prepared, available, isFree))) {
      possible.push(index);
      candidatesOf.set(index, possibleCandidates(prepared, available, isFree));
    } else if (match >= 0 && expected.has(index) && available.bookings[match].id !== expected.get(index)) {
      // The person decided on another booking at the check; this one stays free for the following rows, and the row waits for a new decision.
      stale.push(index);
    } else if (match >= 0 && created.has(index)) {
      // A matched row the person creates as a new booking takes no existing booking, which stays free for the following rows.
      return;
    } else if (match >= 0) {
      used.add(match);
      matches.set(index, available.bookings[match]);
      matched.push({
        reference: available.bookings[match].reference,
        date: available.bookings[match].date
      });
      duplicates.set(index, "existing_booking");
    }
  });

  return {
    duplicates,
    matched,
    possible,
    stale,
    matches,
    candidatesOf
  };
}

/** Most candidates a possible duplicate offers, which bounds the check's response for files with many equal amounts. */
export const maxCandidates = 3;

/** The bookings a possible duplicate may record: same amount within the window, matching text and closer dates first. */
function possibleCandidates<T extends ExistingBooking>(candidate: PreparedBooking<Booking>, prepared: PreparedBookings<T>, available: (index: number) => boolean) {
  const rank = (index: number) => {
    const booking = prepared.bookings[index];

    return (textsMatch(booking, candidate) ? 0 : 100) + bookingDistance(booking, candidate);
  };

  return sameAmountInWindow(candidate, prepared, available).toSorted((left, right) => rank(left) - rank(right)).slice(0, maxCandidates).map(index => prepared.bookings[index]);
}

/** A booking of the same amount whose text differs, on the same date or recorded as a transfer within the window: too uncertain to skip the row, worth a look in the review. */
function hasWeakMatch<T extends ExistingBooking>(candidate: PreparedBooking<Booking>, prepared: PreparedBookings<T>, available: (index: number) => boolean) {
  return sameAmountInWindow(candidate, prepared, available).some(index => {
    const booking = prepared.bookings[index];

    return sameDay(booking, candidate) || booking.transfer;
  });
}
