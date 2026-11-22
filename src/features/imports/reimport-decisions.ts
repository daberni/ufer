import type { ImportType } from "./import-rows";

// What a reimported row does with the booking it matches: the check reports each match with the fields an update changes, and the person decides per row.

export const rowDecisions = ["update", "skip", "create"] as const;

export type RowDecision = typeof rowDecisions[number];

/** The source fields a matched row can update; a person's overrides, manual corrections, category, splits and links are stored separately and stay. */
export type SourceField = "payee" | "description" | "type";

/** An existing booking a row matches, as the review compares it. */
export type ExistingMatch = {
  reference: string;
  date: string;
  amount: number;
  payee: string;
  description: string;
  type: string;
  /** A person's payee or description shown instead of the source text; an update changes the source text below it. */
  payeeOverridden: boolean;
  descriptionOverridden: boolean;
  /** The fields updating from this row changes. */
  changes: SourceField[];
};

export type DuplicateReason = "already_imported" | "existing_booking";

/** A row that matches a booking (`match`, updated unless the person decides otherwise) or may duplicate one (`possible`, which waits for a decision). */
export type RowMatch = {
  line: number;
  /** The target account; references are unique only per account. */
  accountId: string;
  kind: "match" | "possible";
  /** Why a `match` matched: the same reference as an earlier import, or the content of another booking. */
  reason: DuplicateReason | null;
  /** The matched booking, or a possible duplicate's candidates with the most likely first. */
  candidates: ExistingMatch[];
};

/** A person's decision for one row; `reference` names the candidate an update applies to. */
export type DecisionInput = {
  line: number;
  action: RowDecision;
  reference?: string;
};

/** A confident match updates by default; a possible duplicate has no default. */
export function defaultDecision(match: Pick<RowMatch, "kind">): RowDecision | null {
  return match.kind === "match" ? "update" : null;
}

/** Decisions a row offers: a row imported before under the same reference cannot be created a second time. */
export function allowedDecisions(match: Pick<RowMatch, "reason">): readonly RowDecision[] {
  return match.reason === "already_imported" ? ["update", "skip"] : rowDecisions;
}

/** The existing booking's source values and whether a person or rule fixed its type. */
export type UpdatableBooking = {
  counterparty: string;
  description: string;
  type: string;
  /** A manual or rule-set type, a linked transfer or a balance booking keeps its type. */
  typeLocked: boolean;
};

/** The row values an update writes; a row without a type from the file keeps the booking's type. */
export type UpdatingRow = {
  counterparty: string;
  description: string;
  fileType: ImportType | null;
};

/** The source fields that differ between a matched booking and the row that would update it. */
export function sourceChanges(booking: UpdatableBooking, row: UpdatingRow): SourceField[] {
  const changes: SourceField[] = [];

  if (booking.counterparty !== row.counterparty) {
    changes.push("payee");
  }

  if (booking.description !== row.description) {
    changes.push("description");
  }

  if (row.fileType !== null && !booking.typeLocked && booking.type !== row.fileType) {
    changes.push("type");
  }

  return changes;
}

/** A row's decision as the review applies it: the person's choice when the row allows it, else the default. */
export function effectiveDecision(match: RowMatch, chosen: DecisionInput | undefined): DecisionInput | null {
  if (chosen && allowedDecisions(match).includes(chosen.action)) {
    return chosen;
  }

  const action = defaultDecision(match);

  return action ? {
    line: match.line,
    action
  } : null;
}

/** The booking an update applies to: the chosen candidate, else the most likely one. */
export function decisionCandidate(match: RowMatch, decision: DecisionInput | null) {
  return match.candidates.find(candidate => candidate.reference === decision?.reference) ?? match.candidates[0];
}

/** What confirming does with the matched and possibly duplicate rows under the current decisions. */
export function decisionTotals(matches: RowMatch[], chosen: ReadonlyMap<number, DecisionInput>) {
  const totals = {
    created: 0,
    updated: 0,
    unchanged: 0,
    undecided: 0
  };

  // Like the import, one booking takes the update of one row; a possible duplicate whose booking another row updates waits for a new decision.
  const claimed = new Set<string>();

  // Confident matches claim their bookings first, as on import.
  for (const match of matches.toSorted((left, right) => Number(left.kind === "possible") - Number(right.kind === "possible"))) {
    const decision = effectiveDecision(match, chosen.get(match.line));
    const candidate = decision?.action === "update" ? decisionCandidate(match, decision) : undefined;
    const key = candidate ? `${match.accountId}\u0000${candidate.reference}` : "";
    const taken = candidate ? claimed.has(key) : false;

    if (candidate) {
      claimed.add(key);
    }

    if (!decision || (taken && match.kind === "possible")) {
      totals.undecided += 1;
    } else if (decision.action === "create") {
      totals.created += 1;
    } else if (candidate && !taken && candidate.changes.length > 0) {
      totals.updated += 1;
    } else {
      totals.unchanged += 1;
    }
  }

  return totals;
}
