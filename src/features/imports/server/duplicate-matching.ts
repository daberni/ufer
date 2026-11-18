/** Days a booking date may differ: banks and exports disagree between booking and value date, and weekends shift bookings by up to three days. */
export const duplicateDateToleranceDays = 3;

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

/**
 * Finds the imported rows an account already contains. A row is a duplicate when the account has a booking with the same CSV reference, or otherwise a booking with exactly the same amount, a booking date at most `duplicateDateToleranceDays` apart and matching text.
 * Texts match when either side is empty, one normalized text contains the other, or they share a word of at least four characters. Each existing booking absorbs at most one imported row, so genuine repeats beyond the existing ones still import.
 */
export function findDuplicates(candidates: ImportCandidate[], existing: ExistingBooking[]) {
  const duplicates = new Map<number, DuplicateReason>();
  const references = new Set(existing.map(booking => booking.reference));
  const available = existing.filter(booking => !candidates.some(candidate => candidate.reference === booking.reference));
  const used = new Set<number>();

  candidates.forEach((candidate, index) => {
    if (references.has(candidate.reference)) {
      duplicates.set(index, "already_imported");

      return;
    }

    const match = available.findIndex((booking, bookingIndex) => !used.has(bookingIndex) && booking.amount === candidate.amount && dayDistance(booking.date, candidate.date) <= duplicateDateToleranceDays && textsMatch(booking, candidate));

    if (match >= 0) {
      used.add(match);
      duplicates.set(index, "existing_booking");
    }
  });

  return duplicates;
}

export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function textsMatch(left: Pick<ExistingBooking, "counterparty" | "description">, right: Pick<ExistingBooking, "counterparty" | "description">) {
  const leftText = normalizeText(`${left.counterparty} ${left.description}`);
  const rightText = normalizeText(`${right.counterparty} ${right.description}`);

  if (!leftText || !rightText || leftText.includes(rightText) || rightText.includes(leftText)) {
    return true;
  }

  const leftWords = new Set(leftText.split(" ").filter(word => word.length >= 4));

  return rightText.split(" ").some(word => word.length >= 4 && leftWords.has(word));
}

function dayDistance(left: string, right: string) {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}
