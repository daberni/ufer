import { normalizeText } from "@/lib/text";
import { mappedReferencePrefix } from "@/lib/booking-references";

/** Days a booking may lie from its duplicate when a person resolves it: exports and banks can record the same movement on dates further apart than automatic matching accepts. */
export const duplicateSearchDays = 14;

/** A booking's text as shown, overrides included. */
export type DescribedBooking = {
  counterparty: string;
  description: string;
};

/** How much a booking's text says: the length of its normalized payee and description. */
export function descriptionLength(booking: DescribedBooking) {
  return normalizeText(`${booking.counterparty} ${booking.description}`).length;
}

type ResolvableBooking = DescribedBooking & {
  provider_reference: string;
};

/** Whether a booking still comes only from a CSV import: no bank delivery has adopted it, so a sync never brings it back once it is deleted. */
export function csvImported(booking: Pick<ResolvableBooking, "provider_reference">) {
  return booking.provider_reference.startsWith(mappedReferencePrefix);
}

/**
 * Which of two copies of one movement stays and what happens to the other. A CSV-imported copy beside a bank copy is deleted, so the bank copy stays.
 * Otherwise the better-described copy stays, on equal descriptions the booking the person named; the other is deleted when it came from a CSV import and hidden when a sync would deliver it again.
 * `subject` is the booking the person resolves; `original` the one they named it a duplicate of.
 */
export function keptCopy<T extends ResolvableBooking>(subject: T, original: T) {
  const oneFromCsv = csvImported(subject) !== csvImported(original);
  const keepsSubject = oneFromCsv ? csvImported(original) : descriptionLength(subject) > descriptionLength(original);
  const kept = keepsSubject ? subject : original;
  const removed = keepsSubject ? original : subject;

  return {
    kept,
    removed,
    deleted: csvImported(removed)
  };
}

/** The removed copy's text when it says more than the kept copy's, so a CSV copy's better description survives deleting it; undefined keeps the kept copy's text. */
export function carriedText(kept: DescribedBooking, removed: DescribedBooking) {
  if (descriptionLength(removed) <= descriptionLength(kept)) {
    return undefined;
  }

  return {
    counterparty: removed.counterparty,
    description: removed.description
  };
}

type Categorized = {
  category_id: string | null;
  category_source: string;
};

/**
 * The category the kept booking takes over from the removed copy: a person's manual choice survives resolving the duplicate unless the kept booking has a manual category of its own.
 * Undefined leaves the kept booking's category as it is.
 */
export function carriedCategory(kept: Categorized, removed: Categorized) {
  if (kept.category_source === "manual" || removed.category_source !== "manual") {
    return undefined;
  }

  return removed.category_id;
}
