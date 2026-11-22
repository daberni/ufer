import type { OpeningBalance } from "./mapped-import-repository";

/** The opening booking of a new import account: a `current` balance is the account's balance today, so the booking is that amount minus its other transactions; a `start` balance is booked as given. */
export function openingBookingAmount(opening: OpeningBalance, othersTotal: number) {
  return opening.kind === "current" ? opening.amount - othersTotal : opening.amount;
}

/** The opening balance an import booked, with the sum of its account's other transactions. */
export type StoredOpening = {
  id: string;
  date: string;
  amount: number;
  others: number;
};

/**
 * Whether a resumed import states the opening balance the account already has: the same kind (part of the booking's ID), date and amount.
 * A `current` balance is compared as the account's balance, its opening booking plus every other transaction.
 */
export function sameOpening(stored: StoredOpening | null, opening: OpeningBalance | null) {
  if (!opening || !stored) {
    return !opening && !stored;
  }

  const statedAmount = opening.kind === "current" ? stored.amount + stored.others : stored.amount;

  return stored.id === opening.id && stored.date === opening.date && statedAmount === opening.amount;
}
