import { matchBooking, sameDay, prepareBooking, prepareBookings, sameAmountInWindow, type Booking, type PreparedBooking, type PreparedBookings } from "@/lib/booking-matching";

export type ImportCandidate = {
  reference: string;
  date: string;
  amount: number;
  counterparty: string;
  description: string;
};

export type ExistingBooking = {
  reference: string;
  date: string;
  bankBookingDate?: string | null;
  amount: number;
  counterparty: string;
  description: string;
  /** Whether the booking is a transfer between own accounts; each side's source names it differently, so its text rarely matches. */
  transfer: boolean;
};

export type DuplicateReason = "already_imported" | "existing_booking";

/**
 * Finds the imported rows an account already contains. A row is a duplicate when the account has a booking with the same reference, or otherwise a booking `matchBooking` finds, whatever source saved it, including an earlier import of another file.
 * Rows with several matching bookings in the date window, or with a booking of the same amount that only the date or a transfer suggests, are returned as `possible` duplicates and still import.
 * Each existing booking absorbs at most one row. `consumed` lists the bookings earlier batches of this import matched or saved, so a batch never mistakes rows of its own file for duplicates, genuine repeats beyond the existing ones still import and a check reports what confirming saves.
 */
export function findDuplicates(candidates: ImportCandidate[], existing: ExistingBooking[], consumed: ReadonlySet<string> = new Set()) {
  const duplicates = new Map<number, DuplicateReason>();
  const matched: Pick<ExistingBooking, "reference" | "date">[] = [];
  const possible: number[] = [];
  const references = new Map(existing.map(booking => [booking.reference, booking.date]));
  const candidateReferences = new Set(candidates.map(candidate => candidate.reference));
  const available = prepareBookings(existing.filter(booking => !consumed.has(booking.reference) && !candidateReferences.has(booking.reference)));
  const used = new Set<number>();
  const isFree = (index: number) => !used.has(index);

  candidates.forEach((candidate, index) => {
    const importedDate = references.get(candidate.reference);

    if (importedDate !== undefined) {
      duplicates.set(index, "already_imported");
      // A retried import passes its earlier rows back as consumed too, so they never absorb a neighbouring row of a later batch by content.
      matched.push({
        reference: candidate.reference,
        date: importedDate
      });

      return;
    }

    const prepared = prepareBooking(candidate);
    const match = matchBooking(prepared, available, isFree);

    if (match === "ambiguous" || (match < 0 && hasWeakMatch(prepared, available, isFree))) {
      possible.push(index);
    } else if (match >= 0) {
      used.add(match);
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
    possible
  };
}

/** A booking of the same amount whose text differs, on the same date or recorded as a transfer within the window: too uncertain to skip the row, worth a look in the review. */
function hasWeakMatch(candidate: PreparedBooking<Booking>, prepared: PreparedBookings<ExistingBooking>, available: (index: number) => boolean) {
  return sameAmountInWindow(candidate, prepared, available).some(index => {
    const booking = prepared.bookings[index];

    return sameDay(booking, candidate) || booking.transfer;
  });
}
