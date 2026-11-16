"use client";

import ui from "./primitives.module.css";
import styles from "./searchable-select.module.css";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { matchOptions, searchableSelectKeyAction, shownOptionLimit } from "./searchable-select-behavior";

export type SearchableSelectOption<Value> = {
  key: string;
  value: Value;
  label: string;
  icon?: ReactNode;
  /** Shown after the label and read with it, such as a status badge. */
  description?: ReactNode;
};

type Props<Value> = {
  id: string;
  options: readonly SearchableSelectOption<Value>[];
  /** A value no option has, such as undefined, while nothing is selected. */
  value: Value | undefined;
  onChange: (value: Value) => void;
  /** The text in the field: a search, or the selected option's label. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Filters and orders the options for the typed text. */
  match?: (options: readonly SearchableSelectOption<Value>[], query: string) => readonly SearchableSelectOption<Value>[];
  /** Names the options in counts and messages, such as "bank" and "banks". */
  noun: {
    one: string;
    other: string;
  };
  placeholder: string;
  /** Replaces the options with a message, such as a loading, error or empty state. */
  notice?: string;
  busy?: boolean;
  "aria-describedby"?: string;
};

/** An editable combobox: typing filters the options, and only an option picked from the list changes the value. */
export function SearchableSelect<Value>({
  id,
  options,
  value,
  onChange,
  query,
  onQueryChange,
  match = matchOptions,
  noun,
  placeholder,
  notice = "",
  busy = false,
  "aria-describedby": ariaDescribedBy
}: Props<Value>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const selected = options.find(option => Object.is(option.value, value));
  // The selected option's label lists every option again, so another one can be picked without clearing the field first.
  const matches = notice ? [] : match(options, query === selected?.label ? "" : query);
  const shown = matches.slice(0, shownOptionLimit);
  const selectedIndex = shown.findIndex(option => option === selected);
  const active = Math.min(activeIndex, shown.length - 1);
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const countText = (count: number) => (count === 1 ? `1 ${noun.one}` : `${count.toLocaleString("en")} ${noun.other}`);
  const truncated = matches.length > shown.length;
  const listLabel = `${noun.other.charAt(0).toLocaleUpperCase()}${noun.other.slice(1)}`;

  let message = notice;

  if (!message && !matches.length) {
    message = `No ${noun.one} matches “${query.trim()}”.`;
  }

  let announcement = "";

  if (open) {
    announcement = message || (truncated ? `${countText(matches.length)}, showing the first ${shown.length}` : countText(matches.length));
  }

  useEffect(() => {
    if (open) {
      listboxRef.current?.querySelector("[data-active]")?.scrollIntoView({
        block: "nearest"
      });
    }
  }, [open, active]);

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function choose(index: number) {
    const option = shown[index];

    setOpen(false);

    if (option) {
      onChange(option.value);
    }
  }

  function search(text: string) {
    onQueryChange(text);
    // The first match is highlighted, so Enter picks it; the list itself is refiltered from the new text.
    openAt(0);
  }

  function toggle() {
    inputRef.current?.focus();

    if (open) {
      setOpen(false);
    } else {
      openAt(Math.max(selectedIndex, 0));
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const action = searchableSelectKeyAction(event, {
      open,
      activeIndex: active,
      selectedIndex,
      optionCount: shown.length
    });

    if (action.type === "none") {
      return;
    }

    // Tab still moves focus; the other handled keys must not move the caret, submit the form or close a surrounding dialog.
    if (event.key !== "Tab") {
      event.preventDefault();
    }

    event.stopPropagation();

    switch (action.type) {
      case "open":
        openAt(action.activeIndex);
        break;
      case "move":
        setActiveIndex(action.activeIndex);
        break;
      case "select":
        choose(active);
        break;
      case "close":
        setOpen(false);
        break;
    }
  }

  return (
    <div className={styles["searchable-select"]}>
      <div className={styles["control"]}>
        <input
          ref={inputRef}
          id={id}
          className={styles["input"]}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-busy={busy}
          aria-describedby={ariaDescribedBy}
          onChange={event => search(event.target.value)}
          onClick={() => {
            if (!open) {
              openAt(Math.max(selectedIndex, 0));
            }
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={styles["toggle"]}
          tabIndex={-1}
          aria-label={`Show ${noun.other}`}
          aria-expanded={open}
          aria-controls={listboxId}
          onMouseDown={event => event.preventDefault()}
          onClick={toggle}
        >
          <ChevronDown aria-hidden="true" strokeWidth={2.2} />
        </button>
      </div>
      <div className={styles["popup"]} hidden={!open}>
        <ul
          ref={listboxRef}
          id={listboxId}
          className={styles["listbox"]}
          role="listbox"
          aria-label={listLabel}
          onMouseDown={event => event.preventDefault()}
        >
          {open && shown.map((option, index) => (
            <li
              key={option.key}
              id={optionId(index)}
              className={styles["option"]}
              role="option"
              aria-selected={index === selectedIndex}
              data-active={index === active ? "" : undefined}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              {option.icon}
              <span className={styles["label"]}>{option.label}</span>
              {option.description}
              {index === selectedIndex && <Check className={styles["check"]} aria-hidden="true" strokeWidth={2.4} />}
            </li>
          ))}
        </ul>
        {message && <p className={styles["message"]}>{message}</p>}
        {!message && truncated && <p className={styles["message"]}>Showing the first {shown.length} of {countText(matches.length)}. Type to narrow the list.</p>}
      </div>
      <div className={ui["visually-hidden"]} role="status">
        {announcement}
      </div>
    </div>
  );
}
