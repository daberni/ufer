// Matching and keyboard rules of the searchable select, following the ARIA APG editable combobox with list autocomplete.

/** Long lists are cut off at this many shown options; the user narrows them by typing. */
export const shownOptionLimit = 100;

function searchText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

function matchRank(label: string, terms: readonly string[]) {
  if (!terms.every(term => label.includes(term))) {
    return -1;
  }

  if (label.startsWith(terms[0])) {
    return 0;
  }

  return label.split(/[\s\-.(/]+/).some(word => word.startsWith(terms[0])) ? 1 : 2;
}

/**
 * Options whose label contains every typed word, ignoring case and accents. Labels starting with the first word come first, then labels with a
 * word starting with it, then other matches; each group keeps the given order.
 */
export function matchOptions<Option extends {
  label: string;
}>(options: readonly Option[], query: string): Option[] {
  const terms = searchText(query).split(/\s+/).filter(Boolean);

  if (!terms.length) {
    return [...options];
  }

  return options
    .map(option => ({
      option,
      rank: matchRank(searchText(option.label), terms)
    }))
    .filter(match => match.rank >= 0)
    .sort((left, right) => left.rank - right.rank)
    .map(match => match.option);
}

function sameLabel(left: string, right: string) {
  return left.trim().normalize("NFC").toLocaleLowerCase() === right.trim().normalize("NFC").toLocaleLowerCase();
}

/** The name a create option would use: the typed text, unless it is empty or an option already has that label, ignoring case. */
export function creatableName(options: readonly {
  label: string;
}[], query: string) {
  const name = query.trim();

  if (!name || options.some(option => sameLabel(option.label, name))) {
    return "";
  }

  return name;
}

export type SearchableSelectKey = {
  key: string;
  altKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type SearchableSelectState = {
  open: boolean;
  /** -1 while no option is highlighted. */
  activeIndex: number;
  selectedIndex: number;
  optionCount: number;
};

export type SearchableSelectAction = {
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

/** Typing on the toggle button hands the text to the search field. */
export type SearchableSelectToggleAction = SearchableSelectAction | {
  type: "search";
  text: string;
};

const pageSize = 10;

const none: SearchableSelectAction = {
  type: "none"
};

function closedAction(input: SearchableSelectKey, state: SearchableSelectState): SearchableSelectAction {
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

function openAction(input: SearchableSelectKey, state: SearchableSelectState): SearchableSelectAction {
  const hasActiveOption = state.activeIndex >= 0 && state.activeIndex < state.optionCount;

  if (input.key === "Enter") {
    // Without a highlighted option, Enter only closes the list instead of submitting the form.
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
export function searchableSelectKeyAction(input: SearchableSelectKey, state: SearchableSelectState): SearchableSelectAction {
  return state.open ? openAction(input, state) : closedAction(input, state);
}

function isPrintable(input: SearchableSelectKey) {
  return input.key.length === 1 && input.key !== " " && !input.altKey && !input.ctrlKey && !input.metaKey;
}

/** The toggle button works the list like a select without editing text: Enter and Space open it or pick the highlighted option, and typing starts a search. */
export function searchableSelectToggleKeyAction(input: SearchableSelectKey, state: SearchableSelectState): SearchableSelectToggleAction {
  if (isPrintable(input)) {
    return {
      type: "search",
      text: input.key
    };
  }

  const confirms = input.key === "Enter" || input.key === " ";

  if (confirms && !state.open) {
    return {
      type: "open",
      activeIndex: state.selectedIndex >= 0 ? state.selectedIndex : Math.min(0, state.optionCount - 1)
    };
  }

  const key = confirms ? "Enter" : input.key;

  return searchableSelectKeyAction({
    ...input,
    key
  }, state);
}
