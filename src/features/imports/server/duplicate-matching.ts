import { duplicateDateToleranceDays, normalizeText } from "../csv-mapping";

export { duplicateDateToleranceDays };

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
  amount: number;
  counterparty: string;
  description: string;
  /** Whether the booking is a transfer between own accounts; each side's source names it differently, so its text rarely matches. */
  transfer: boolean;
};

export type DuplicateReason = "already_imported" | "existing_booking";

/** Prefix of references the mapped CSV import derives from row content or an export ID. */
export const mappedReferencePrefix = "csv:m:";

/**
 * Finds the imported rows an account already contains. A row is a duplicate when the account has a booking with the same reference, or otherwise a booking `matchBooking` finds, whatever source saved it, including an earlier import of another file.
 * Rows with several matching bookings in the date window, or with a booking of the same amount that only the date or a transfer suggests, are returned as `possible` duplicates and still import.
 * Each existing booking absorbs at most one row. `consumed` lists the bookings earlier batches of this import matched or saved, so a batch never mistakes rows of its own file for duplicates, genuine repeats beyond the existing ones still import and a check reports what confirming saves.
 */
export function findDuplicates(candidates: ImportCandidate[], existing: ExistingBooking[], consumed: ReadonlySet<string> = new Set()) {
  const duplicates = new Map<number, DuplicateReason>();
  const matched: Pick<ExistingBooking, "reference" | "date">[] = [];
  const possible: number[] = [];
  const references = new Set(existing.map(booking => booking.reference));
  const candidateReferences = new Set(candidates.map(candidate => candidate.reference));
  const available = prepareBookings(existing.filter(booking => !consumed.has(booking.reference) && !candidateReferences.has(booking.reference)));
  const used = new Set<number>();
  const isFree = (index: number) => !used.has(index);

  candidates.forEach((candidate, index) => {
    if (references.has(candidate.reference)) {
      duplicates.set(index, "already_imported");

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

type Booking = Pick<ExistingBooking, "date" | "amount" | "counterparty" | "description">;

type PreparedBooking<T extends Booking> = T & {
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

/** A booking of the same amount whose text differs, on the same date or recorded as a transfer within the window: too uncertain to skip the row, worth a look in the review. */
function hasWeakMatch(candidate: PreparedBooking<Booking>, prepared: PreparedBookings<ExistingBooking>, available: (index: number) => boolean) {
  return sameAmountInWindow(candidate, prepared, available).some(index => {
    const booking = prepared.bookings[index];

    return booking.date === candidate.date || booking.transfer;
  });
}

function sameAmountInWindow<T extends Booking>(candidate: Booking, prepared: PreparedBookings<T>, available: (index: number) => boolean) {
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
