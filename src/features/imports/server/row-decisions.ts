import { sourceChanges, type ExistingMatch, type RowDecision, type RowMatch, type SourceField } from "../reimport-decisions";
import type { ExistingBooking, findDuplicates } from "./duplicate-matching";
import type { MappedEntry } from "./mapped-import-repository";

/** A booking an imported row may match, with what the review compares and an update may change. */
export type StoredBooking = ExistingBooking & {
  id: string;
  type: string;
  typeLocked: boolean;
  payeeOverridden: boolean;
  descriptionOverridden: boolean;
};

export type Decision = {
  action: RowDecision;
  /** The ID of the booking an update applies to. */
  booking?: string;
};

type Found = ReturnType<typeof findDuplicates<StoredBooking>>;

export type RowUpdate = {
  index: number;
  reference: string;
  changes: SourceField[];
};

/**
 * What each classified row does: new rows are inserted; a confident match updates its booking's source fields unless the person skips it or, for a content match, creates it anyway; a possible duplicate does only what the person decided and is otherwise left out as `undecided`.
 * One booking takes the update of at most one row; an update without changes writes nothing.
 */
export function planRows(entries: MappedEntry[], found: Found, decisions: ReadonlyMap<number, Decision>) {
  const inserts: number[] = [];
  const updates: RowUpdate[] = [];
  const undecided: number[] = [];
  /** Bookings a possible duplicate updates, which later batches treat as matched. */
  const adopted: Pick<StoredBooking, "reference" | "date">[] = [];
  const claimed = new Set<string>();
  /** Bookings a confident match found but a stale decision rejected; they are not reported as matched. */
  const released = new Set<string>();
  const update = (index: number, booking: StoredBooking) => {
    if (claimed.has(booking.reference)) {
      return false;
    }

    claimed.add(booking.reference);
    const changes = sourceChanges(booking, entries[index]);

    if (changes.length > 0) {
      updates.push({
        index,
        reference: booking.reference,
        changes
      });
    }

    return true;
  };

  // Confident matches claim their bookings before possible duplicates, so a possible duplicate never takes a booking from a confident match, whatever the row order.
  const order = entries.map((_entry, index) => index).toSorted((left, right) => Number(!found.duplicates.has(left)) - Number(!found.duplicates.has(right)));

  order.forEach(index => {
    const decision = decisions.get(index);
    const reason = found.duplicates.get(index);
    const booking = found.matches.get(index);

    if (reason && booking) {
      const action = decision?.action ?? "update";

      if (action === "create" && reason === "existing_booking") {
        inserts.push(index);
      } else if (action === "update" && decision?.booking !== undefined && decision.booking !== booking.id) {
        // The person chose another booking at the check; never update a different one, and leave this one free for other rows and batches.
        undecided.push(index);
        released.add(booking.reference);
      } else if (action === "update") {
        update(index, booking);
      }

      return;
    }

    const candidates = found.candidatesOf.get(index);

    if (!candidates) {
      // A row decided at the check whose booking changed meanwhile never turns an update into a new booking.
      if (decision?.action === "update") {
        undecided.push(index);
      } else if (decision?.action !== "skip") {
        inserts.push(index);
      }

      return;
    }

    if (decision?.action === "create") {
      inserts.push(index);

      return;
    }

    if (decision?.action === "skip") {
      return;
    }

    const chosen = decision ? candidates.find(candidate => candidate.id === (decision.booking ?? candidates[0]?.id)) : undefined;

    // An update whose booking is gone or already taken by another row waits for a new decision, like a row without one.
    if (!chosen || !update(index, chosen)) {
      undecided.push(index);

      return;
    }

    adopted.push({
      reference: chosen.reference,
      date: chosen.date
    });
  });

  inserts.sort((left, right) => left - right);

  return {
    inserts,
    updates,
    undecided,
    adopted,
    released
  };
}

/** Characters of a candidate's payee or description the review shows; changes are computed on the full text, and the cap bounds the check's response when many rows share long candidates. */
export const shownTextLength = 120;

function shortened(text: string) {
  return text.length > shownTextLength ? `${text.slice(0, shownTextLength - 1)}…` : text;
}

/** The review's view of each matched or possibly duplicate row, by index. */
export function describeMatches(entries: MappedEntry[], found: Found) {
  const described = new Map<number, Omit<RowMatch, "line" | "accountId">>();
  const existingMatch = (index: number, booking: StoredBooking): ExistingMatch => ({
    id: booking.id,
    date: booking.date,
    amount: booking.amount,
    payee: shortened(booking.counterparty),
    description: shortened(booking.description),
    type: booking.type,
    payeeOverridden: booking.payeeOverridden,
    descriptionOverridden: booking.descriptionOverridden,
    changes: sourceChanges(booking, entries[index])
  });

  for (const [index, booking] of found.matches) {
    described.set(index, {
      description: entries[index].description,
      kind: "match",
      reason: found.duplicates.get(index) ?? null,
      candidates: [existingMatch(index, booking)]
    });
  }

  for (const [index, candidates] of found.candidatesOf) {
    described.set(index, {
      description: entries[index].description,
      kind: "possible",
      reason: null,
      candidates: candidates.map(booking => existingMatch(index, booking))
    });
  }

  return described;
}
