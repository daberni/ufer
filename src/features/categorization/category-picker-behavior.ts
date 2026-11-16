// Keyboard, typeahead and placement rules of the category picker, following the ARIA APG select-only combobox.

export type PickerKey = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export type PickerState = {
  open: boolean;
  activeIndex: number;
  selectedIndex: number;
  optionCount: number;
  /** A typeahead search is in progress, so Space continues it instead of selecting. */
  typing: boolean;
};

export type PickerAction = {
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
  type: "typeahead";
  character: string;
} | {
  type: "none";
};

const pageSize = 10;

function isPrintable(input: PickerKey) {
  return input.key.length === 1 && !input.ctrlKey && !input.metaKey && !input.altKey;
}

function clampIndex(index: number, optionCount: number) {
  return Math.min(Math.max(index, 0), optionCount - 1);
}

function closedAction(input: PickerKey, state: PickerState): PickerAction {
  const lastIndex = state.optionCount - 1;
  const openKeys = ["ArrowDown", "ArrowUp", "Enter", " "];

  if (openKeys.includes(input.key)) {
    return {
      type: "open",
      activeIndex: Math.max(state.selectedIndex, 0)
    };
  }

  if (input.key === "Home" || input.key === "End") {
    return {
      type: "open",
      activeIndex: input.key === "Home" ? 0 : lastIndex
    };
  }

  if (isPrintable(input)) {
    return {
      type: "typeahead",
      character: input.key
    };
  }

  return {
    type: "none"
  };
}

const openMoves: Record<string, (activeIndex: number, lastIndex: number) => number> = {
  ArrowDown: activeIndex => activeIndex + 1,
  ArrowUp: activeIndex => activeIndex - 1,
  Home: () => 0,
  End: (_, lastIndex) => lastIndex,
  PageDown: activeIndex => activeIndex + pageSize,
  PageUp: activeIndex => activeIndex - pageSize
};

function openAction(input: PickerKey, state: PickerState): PickerAction {
  const selectsOnSpace = input.key === " " && !state.typing;
  const selectsOnAltUp = input.key === "ArrowUp" && input.altKey;

  if (input.key === "Enter" || selectsOnSpace || selectsOnAltUp) {
    return {
      type: "select"
    };
  }

  // Tab closes without committing because choosing a category saves immediately.
  if (input.key === "Escape" || input.key === "Tab") {
    return {
      type: "close"
    };
  }

  const move = openMoves[input.key];

  if (move) {
    return {
      type: "move",
      activeIndex: clampIndex(move(state.activeIndex, state.optionCount - 1), state.optionCount)
    };
  }

  if (isPrintable(input)) {
    return {
      type: "typeahead",
      character: input.key
    };
  }

  return {
    type: "none"
  };
}

export function pickerKeyAction(input: PickerKey, state: PickerState): PickerAction {
  if (state.optionCount === 0) {
    return {
      type: "none"
    };
  }

  return state.open ? openAction(input, state) : closedAction(input, state);
}

/**
 * Finds the option whose label starts with the typed text. A single or repeated character cycles through matches after the active option;
 * a longer query keeps the active option while it still matches.
 */
export function typeaheadIndex(labels: readonly string[], query: string, activeIndex: number) {
  const normalized = query.toLocaleLowerCase();
  const repeatsOneCharacter = [...normalized].every(character => character === normalized[0]);
  const search = repeatsOneCharacter ? normalized.slice(0, 1) : normalized;
  const start = repeatsOneCharacter ? activeIndex + 1 : Math.max(activeIndex, 0);

  if (!search) {
    return -1;
  }

  for (let offset = 0; offset < labels.length; offset++) {
    const index = (start + offset) % labels.length;

    if (labels[index].toLocaleLowerCase().startsWith(search)) {
      return index;
    }
  }

  return -1;
}

export type Box = {
  top: number;
  bottom: number;
  left: number;
};

export type Size = {
  width: number;
  height: number;
};

export type PopoverPlacement = {
  top: number;
  left: number;
  maxHeight: number;
};

const anchorGap = 6;
const viewportMargin = 16;

/** Opens below the anchor unless the list fits better above it, and keeps the popover inside the viewport's side margins. */
export function popoverPlacement(anchor: Box, popover: Size, viewport: Size): PopoverPlacement {
  const spaceBelow = viewport.height - anchor.bottom - anchorGap - viewportMargin;
  const spaceAbove = anchor.top - anchorGap - viewportMargin;
  const opensBelow = popover.height <= spaceBelow || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(opensBelow ? spaceBelow : spaceAbove, 0);
  const height = Math.min(popover.height, maxHeight);
  const top = opensBelow ? anchor.bottom + anchorGap : anchor.top - anchorGap - height;
  const rightLimit = viewport.width - viewportMargin - popover.width;
  const left = Math.max(Math.min(anchor.left, rightLimit), viewportMargin);

  return {
    top,
    left,
    maxHeight
  };
}
