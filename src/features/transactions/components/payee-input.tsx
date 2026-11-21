"use client";

import styles from "../../../components/ui/searchable-select.module.css";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { useAnchoredPopover } from "@/components/ui/use-anchored-popover";
import { useComboboxOptions } from "@/components/ui/use-combobox-options";
import { useDismiss } from "@/components/ui/use-dismiss";
import { usePayeeSuggestions } from "@/features/transactions/queries";
import { commitDelay } from "@/features/transactions/use-search-draft";

type Props = {
  label: string;
  name: string;
  maxLength: number;
  defaultValue?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  "aria-describedby"?: string;
  /** Called with the field's text after typing or picking a suggestion. */
  onValueChange?: (value: string) => void;
};

/**
 * A free-text payee field that suggests existing payees while typing, following the ARIA editable combobox with list autocomplete. Picking a suggestion
 * only fills the field; the field submits with its form like a plain input. The list stays outside the label, so suggestions never join the field's name.
 */
export function PayeeInput({
  label,
  name,
  maxLength,
  defaultValue = "",
  inputRef,
  "aria-describedby": ariaDescribedBy,
  onValueChange
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(defaultValue);
  // The text suggestions were last requested for; it follows typing once typing pauses.
  const [requested, setRequested] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const suggestions = usePayeeSuggestions(open ? requested : "");
  // Suggestions only show for the text in the field, so results for earlier text cannot overwrite newer typing.
  const shown = open && query === requested ? suggestions.data?.payees ?? [] : [];
  const expanded = shown.length > 0;
  // The suggestions last shown for the current text, so keys that reopen a closed list start on them, such as ArrowDown after Escape.
  const [knownCount, setKnownCount] = useState(0);

  // An arrow key that opened the list before any suggestions were known waits for them: ArrowDown highlights the first, ArrowUp the last.
  const [awaitedHighlight, setAwaitedHighlight] = useState<"first" | "last" | null>(null);

  if (expanded && shown.length !== knownCount) {
    setKnownCount(shown.length);
  }

  const {
    listboxId,
    optionId,
    active,
    setActiveIndex,
    activeDescendant,
    handleKeyDown
  } = useComboboxOptions({
    // A list that was asked to open counts as open for every key while its suggestions load, so Escape, Alt+ArrowUp and Tab close it.
    open,
    optionCount: expanded ? shown.length : knownCount,
    listboxRef,
    freeText: true,
    onOpen: () => setOpen(true),
    onSelect: index => pick(shown[index]),
    onClose: close
  });

  if (awaitedHighlight && expanded) {
    setAwaitedHighlight(null);
    setActiveIndex(awaitedHighlight === "first" ? 0 : shown.length - 1);
  }

  useEffect(() => {
    if (query === requested) {
      return;
    }

    const timer = setTimeout(() => setRequested(query), commitDelay);

    return () => clearTimeout(timer);
  }, [query, requested]);

  useAnchoredPopover({
    open: expanded,
    anchorRef: input,
    popupRef,
    matchAnchorWidth: true
  });

  // Touch browsers keep the field focused when a tap lands on something that cannot take focus, so blurring alone does not close the list.
  // While the list is open, shown or still waiting for its suggestions, the field owns outside presses, so it cannot open after the user moved on.
  useDismiss({
    active: open,
    inside: [input, popupRef],
    onDismiss: close
  });

  function close() {
    setOpen(false);
    setAwaitedHighlight(null);
    setActiveIndex(-1);
  }

  function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const awaitsSuggestions = !expanded && knownCount === 0;

    handleKeyDown(event);

    // Alt+ArrowDown opens the list without a highlight, so only plain arrows wait for one.
    if (awaitsSuggestions && !event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setAwaitedHighlight(event.key === "ArrowDown" ? "first" : "last");
    }
  }

  function pick(payee: string) {
    if (input.current) {
      input.current.value = payee;
    }

    setQuery(payee);
    setRequested(payee);
    close();
    onValueChange?.(payee);
  }

  return (
    <>
      <label>
        {label}
        <input
          ref={element => {
            input.current = element;

            if (inputRef) {
              inputRef.current = element;
            }
          }}
          name={name}
          maxLength={maxLength}
          defaultValue={defaultValue}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          aria-describedby={ariaDescribedBy}
          onChange={event => {
            setQuery(event.target.value);
            setKnownCount(0);
            setAwaitedHighlight(null);
            setOpen(true);
            setActiveIndex(-1);
            onValueChange?.(event.target.value);
          }}
          onBlur={close}
          onKeyDown={handleFieldKeyDown}
        />
      </label>
      <div ref={popupRef} className={styles["popup"]} popover="manual">
        <ul
          ref={listboxRef}
          id={listboxId}
          className={styles["listbox"]}
          role="listbox"
          aria-label="Existing payees"
          // Keeps focus in the field, so picking with a pointer does not blur and close the list first.
          onMouseDown={event => event.preventDefault()}
        >
          {shown.map((payee, index) => (
            <li
              key={payee}
              id={optionId(index)}
              className={styles["option"]}
              role="option"
              aria-selected={index === active}
              data-active={index === active ? "" : undefined}
              onClick={() => pick(payee)}
            >
              <span className={styles["label"]}>{payee}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
