import { decimalAmount, minorUnits } from "@/lib/money";
import type { SplitPartEdit } from "@/features/transactions/mutations";
import type { Transaction } from "@/features/transactions/types";
import { maximumSplitParts, partAmountSupported } from "@/features/transactions/split-limits";

/** A part the person entered; its amount is text in the booking's direction, so an expense's spending is positive. */
export type DraftPart = {
  key: number;
  amount: string;
  categoryId: string | null;
  note: string;
};

/**
 * A split being edited. Whatever the entered parts leave of the booking becomes the remainder part, whose amount always follows the others; only its category and note are chosen.
 * The remainder keeps them while the entered parts cover the booking, so they return when it reappears.
 */
export type SplitDraft = {
  parts: DraftPart[];
  remainder: {
    categoryId: string | null;
    note: string;
  };
  nextKey: number;
};

/** Why the draft cannot be saved as a split yet, or `ready`. A `single` draft is one part that covers the booking, which is a plain category. */
export type DraftStatus = "invalid" | "incomplete" | "over" | "single" | "ready";

export type DraftState = {
  /** Each entered part's signed minor units, or null while its amount is empty or invalid. */
  amounts: (number | null)[];
  /** Assigned by the entered parts, in the booking's direction. */
  assigned: number;
  /** Still to assign, in the booking's direction; the remainder part's amount while positive. */
  remaining: number;
  status: DraftStatus;
  /** Whether another entered part fits within the part limit. */
  canAdd: boolean;
};

/** Part amounts are entered in the booking's direction: positive for an expense's spending or an income's receipt. */
function direction(transaction: Pick<Transaction, "amount_minor">) {
  return transaction.amount_minor < 0 ? -1 : 1;
}

/** An existing split's parts, or one part covering the booking with its current category. */
export function initialDraft(transaction: Pick<Transaction, "amount_minor" | "currency" | "split">, categoryId: string | null): SplitDraft {
  const sign = direction(transaction);
  const parts = transaction.split ? transaction.split.parts.map((part, index) => ({
    key: index,
    amount: decimalAmount(part.amount_minor * sign, transaction.currency),
    categoryId: part.category_id,
    note: part.note
  })) : [{
    key: 0,
    amount: decimalAmount(transaction.amount_minor * sign, transaction.currency),
    categoryId,
    note: ""
  }];

  return {
    parts,
    remainder: {
      categoryId: null,
      note: ""
    },
    nextKey: parts.length
  };
}

/** A part's signed minor units; undefined while empty, null when invalid, zero or beyond the supported range. */
function partAmount(part: DraftPart, transaction: Pick<Transaction, "amount_minor" | "currency">) {
  if (part.amount.trim() === "") {
    return undefined;
  }

  try {
    const amount = minorUnits(part.amount, transaction.currency) * direction(transaction);

    return amount === 0 || !partAmountSupported(amount) ? null : amount;
  } catch {
    return null;
  }
}

export function draftState(draft: SplitDraft, transaction: Pick<Transaction, "amount_minor" | "currency">): DraftState {
  const sign = direction(transaction);
  const parsed = draft.parts.map(part => partAmount(part, transaction));
  const amounts = parsed.map(amount => amount ?? null);
  const assigned = amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) * sign;
  const remaining = transaction.amount_minor * sign - assigned;
  const partCount = draft.parts.length + (remaining > 0 ? 1 : 0);
  const canAdd = partCount < maximumSplitParts;

  if (parsed.includes(null)) {
    return {
      amounts,
      assigned,
      remaining,
      status: "invalid",
      canAdd
    };
  }

  if (parsed.includes(undefined)) {
    return {
      amounts,
      assigned,
      remaining,
      status: "incomplete",
      canAdd
    };
  }

  let status: DraftStatus = "ready";

  if (remaining < 0) {
    status = "over";
  } else if (partCount < 2) {
    status = "single";
  }

  return {
    amounts,
    assigned,
    remaining,
    status,
    canAdd
  };
}

/** The parts to save, the remainder last; only meaningful for a `ready` draft. */
export function draftEdits(draft: SplitDraft, transaction: Pick<Transaction, "amount_minor" | "currency">): SplitPartEdit[] {
  const state = draftState(draft, transaction);
  const sign = direction(transaction);
  const entered = draft.parts.map((part, index) => ({
    amount: decimalAmount(state.amounts[index] ?? 0, transaction.currency),
    category_id: part.categoryId,
    note: part.note.trim()
  }));

  if (state.remaining <= 0) {
    return entered;
  }

  return [...entered, {
    amount: decimalAmount(state.remaining * sign, transaction.currency),
    category_id: draft.remainder.categoryId,
    note: draft.remainder.note.trim()
  }];
}
