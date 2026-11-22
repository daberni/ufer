import { normalizeText } from "@/lib/text";

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

/**
 * Which of two copies of one movement stays: the better-described one. On equal descriptions the booking the person named as the original stays.
 * `subject` is the booking the person resolves; `original` the one they named it a duplicate of.
 */
export function keptCopy<T extends DescribedBooking>(subject: T, original: T) {
  if (descriptionLength(subject) > descriptionLength(original)) {
    return {
      kept: subject,
      hidden: original
    };
  }

  return {
    kept: original,
    hidden: subject
  };
}

type Categorized = {
  category_id: string | null;
  category_source: string;
};

/**
 * The category the kept booking takes over from the hidden copy: a person's manual choice survives resolving the duplicate unless the kept booking has a manual category of its own.
 * Undefined leaves the kept booking's category as it is.
 */
export function carriedCategory(kept: Categorized, hidden: Categorized) {
  if (kept.category_source === "manual" || hidden.category_source !== "manual") {
    return undefined;
  }

  return hidden.category_id;
}
