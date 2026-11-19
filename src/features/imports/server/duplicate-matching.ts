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
};

export type DuplicateReason = "already_imported" | "existing_booking";

/** Prefix of references the mapped CSV import derives from row content; such rows match later imports only by reference. */
export const mappedReferencePrefix = "csv:m:";

/**
 * Finds the imported rows an account already contains. A row is a duplicate when the account has a booking with the same reference, or otherwise a booking `matchBooking` finds; rows with several bookings in the date window are returned as `possible` duplicates and still import.
 * Rows saved by a mapped import never match by content, so a batch never mistakes rows of the same file saved by an earlier batch for duplicates. Each existing booking absorbs at most one row, including rows of earlier batches listed in `consumed`, so genuine repeats beyond the existing ones still import and a check reports what confirming saves.
 */
export function findDuplicates(candidates: ImportCandidate[], existing: ExistingBooking[], consumed: ReadonlySet<string> = new Set()) {
  const duplicates = new Map<number, DuplicateReason>();
  const matched: Pick<ExistingBooking, "reference" | "date">[] = [];
  const possible: number[] = [];
  const references = new Set(existing.map(booking => booking.reference));
  const available = existing.filter(booking => !booking.reference.startsWith(mappedReferencePrefix) && !consumed.has(booking.reference) && !candidates.some(candidate => candidate.reference === booking.reference));
  const used = new Set<number>();

  candidates.forEach((candidate, index) => {
    if (references.has(candidate.reference)) {
      duplicates.set(index, "already_imported");

      return;
    }

    const match = matchBooking(candidate, available, bookingIndex => !used.has(bookingIndex));

    if (match === "ambiguous") {
      possible.push(index);
    } else if (match >= 0) {
      used.add(match);
      matched.push({
        reference: available[match].reference,
        date: available[match].date
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

/**
 * The booking that records the same movement as `candidate`: exactly the same amount and matching text, on the same booking date, or else the only such booking at most `duplicateDateToleranceDays` apart.
 * Several bookings within the window are "ambiguous" and match none; -1 means no match.
 */
export function matchBooking(candidate: Booking, bookings: Booking[], available: (index: number) => boolean): number | "ambiguous" {
  const fits = bookings.flatMap((booking, index) => available(index) && booking.amount === candidate.amount && dayDistance(booking.date, candidate.date) <= duplicateDateToleranceDays && textsMatch(booking, candidate) ? [index] : []);
  const sameDate = fits.find(index => bookings[index].date === candidate.date);

  if (sameDate !== undefined) {
    return sameDate;
  }

  if (fits.length > 1) {
    return "ambiguous";
  }

  return fits[0] ?? -1;
}

export function textsMatch(left: Pick<ExistingBooking, "counterparty" | "description">, right: Pick<ExistingBooking, "counterparty" | "description">) {
  const leftText = normalizeText(`${left.counterparty} ${left.description}`);
  const rightText = normalizeText(`${right.counterparty} ${right.description}`);

  if (!leftText || !rightText) {
    return false;
  }

  if (leftText.includes(rightText) || rightText.includes(leftText)) {
    return true;
  }

  const leftWords = new Set(leftText.split(" ").filter(word => word.length >= 4));

  return rightText.split(" ").some(word => word.length >= 4 && leftWords.has(word));
}

export function dayDistance(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}
