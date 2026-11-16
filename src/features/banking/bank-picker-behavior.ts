// Filtering and keyboard rules of the bank picker, following the ARIA APG editable combobox with list autocomplete.

import type { Bank } from "@/features/dashboard/types";

/** Production directories list thousands of institutions; longer results are cut off and the user narrows them by typing. */
export const shownBankLimit = 100;

function searchText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

function matchRank(name: string, terms: readonly string[]) {
  if (!terms.every(term => name.includes(term))) {
    return -1;
  }

  if (name.startsWith(terms[0])) {
    return 0;
  }

  return name.split(/[\s\-.(/]+/).some(word => word.startsWith(terms[0])) ? 1 : 2;
}

export type BankMatches = {
  banks: Bank[];
  /** All matching banks, including those beyond the shown limit. */
  total: number;
};

/**
 * Banks whose name contains every typed word, ignoring case and accents. Names starting with the first word come first, then names with a word
 * starting with it; each group is alphabetical. A bank listed twice under the same name is offered once.
 */
export function matchingBanks(banks: readonly Bank[], query: string, limit = shownBankLimit): BankMatches {
  const terms = searchText(query).split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const ranked: {
    bank: Bank;
    rank: number;
  }[] = [];

  for (const bank of banks) {
    if (seen.has(bank.name)) {
      continue;
    }

    seen.add(bank.name);
    const rank = terms.length ? matchRank(searchText(bank.name), terms) : 0;

    if (rank >= 0) {
      ranked.push({
        bank,
        rank
      });
    }
  }

  ranked.sort((left, right) => left.rank - right.rank || left.bank.name.localeCompare(right.bank.name));

  return {
    banks: ranked.slice(0, limit).map(match => match.bank),
    total: ranked.length
  };
}

export type BankPickerKey = {
  key: string;
  altKey: boolean;
};

export type BankPickerState = {
  open: boolean;
  /** -1 while no option is highlighted. */
  activeIndex: number;
  selectedIndex: number;
  optionCount: number;
};

export type BankPickerAction = {
  type: "open";
  activeIndex: number;
} | {
  type: "move";
  activeIndex: number;
} | {
  type: "select";
} | {
  type: "close";
} | {
  type: "none";
};

const pageSize = 10;

const none: BankPickerAction = {
  type: "none"
};

function closedAction(input: BankPickerKey, state: BankPickerState): BankPickerAction {
  const lastIndex = state.optionCount - 1;
  const fallbackIndex = input.key === "ArrowUp" ? lastIndex : Math.min(0, lastIndex);

  if (input.key !== "ArrowDown" && input.key !== "ArrowUp") {
    return none;
  }

  if (input.altKey) {
    return {
      type: "open",
      activeIndex: -1
    };
  }

  return {
    type: "open",
    activeIndex: state.selectedIndex >= 0 ? state.selectedIndex : fallbackIndex
  };
}

const openMoves: Record<string, (activeIndex: number) => number> = {
  ArrowDown: activeIndex => activeIndex + 1,
  ArrowUp: activeIndex => activeIndex - 1,
  PageDown: activeIndex => activeIndex + pageSize,
  PageUp: activeIndex => activeIndex - pageSize
};

function openAction(input: BankPickerKey, state: BankPickerState): BankPickerAction {
  const hasActiveOption = state.activeIndex >= 0 && state.activeIndex < state.optionCount;

  if (input.key === "Enter") {
    // Without a highlighted bank, Enter only closes the list instead of submitting the form.
    return hasActiveOption ? {
      type: "select"
    } : {
      type: "close"
    };
  }

  if (input.key === "Escape" || input.key === "Tab" || (input.key === "ArrowUp" && input.altKey)) {
    return {
      type: "close"
    };
  }

  const move = openMoves[input.key];

  if (!move || state.optionCount === 0) {
    return none;
  }

  return {
    type: "move",
    activeIndex: Math.min(Math.max(move(state.activeIndex), 0), state.optionCount - 1)
  };
}

/** Home, End, the arrow keys left and right and typing keep editing the search text; typing is handled by the input's change. */
export function bankPickerKeyAction(input: BankPickerKey, state: BankPickerState): BankPickerAction {
  return state.open ? openAction(input, state) : closedAction(input, state);
}
