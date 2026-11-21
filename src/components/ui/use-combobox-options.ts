"use client";

import { useEffect, useId, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { searchableSelectKeyAction, type SearchableSelectAction, type SearchableSelectState } from "./searchable-select-behavior";

type Options = {
  open: boolean;
  optionCount: number;
  /** The option the list opens on by keyboard, -1 when there is none. */
  selectedIndex?: number;
  listboxRef: RefObject<HTMLElement | null>;
  onOpen: () => void;
  onSelect: (index: number) => void;
  onClose: () => void;
};

/**
 * The highlighted option of an editable combobox's listbox and its keyboard rules, following the ARIA APG combobox with list autocomplete. Focus stays in
 * the field; the highlighted option is exposed through `aria-activedescendant` and scrolled into view.
 */
export function useComboboxOptions({
  open,
  optionCount,
  selectedIndex = -1,
  listboxRef,
  onOpen,
  onSelect,
  onClose
}: Options) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const active = Math.min(activeIndex, optionCount - 1);
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const keyState: SearchableSelectState = {
    open,
    activeIndex: active,
    selectedIndex,
    optionCount
  };

  useEffect(() => {
    if (open) {
      listboxRef.current?.querySelector("[data-active]")?.scrollIntoView({
        block: "nearest"
      });
    }
  }, [open, active, listboxRef]);

  function apply(event: KeyboardEvent, action: SearchableSelectAction) {
    if (action.type === "none") {
      return;
    }

    // Tab still moves focus; the other handled keys must not move the caret, click a button, submit the form or close a surrounding dialog.
    if (event.key !== "Tab") {
      event.preventDefault();
    }

    event.stopPropagation();

    switch (action.type) {
      case "open":
        setActiveIndex(action.activeIndex);
        onOpen();
        break;
      case "move":
        setActiveIndex(action.activeIndex);
        break;
      case "select":
        onSelect(active);
        break;
      case "close":
        onClose();
        break;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    apply(event, searchableSelectKeyAction(event, keyState));
  }

  return {
    listboxId,
    optionId,
    active,
    setActiveIndex,
    activeDescendant: open && active >= 0 ? optionId(active) : undefined,
    keyState,
    apply,
    handleKeyDown
  };
}
