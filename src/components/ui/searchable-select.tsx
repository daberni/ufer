"use client";

import ui from "./primitives.module.css";
import styles from "./searchable-select.module.css";
import { Check, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { matchOptions, searchableSelectKeyAction, shownOptionLimit } from "./searchable-select-behavior";
import { popoverMaxWidth, popoverPlacement, visibleArea } from "./popover-placement";
import { useDismiss } from "./use-dismiss";

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
  /** Shown below the options while the list is open, such as a note about the choice. */
  footer?: ReactNode;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

/** An editable combobox: typing filters the options, and only an option picked from the list changes the value. The list is a popover anchored to the field. */
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
  footer,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy
}: Props<Value>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
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
  const selectedIcon = selected && query === selected.label ? selected.icon : undefined;

  let message = notice;

  if (!message && !matches.length) {
    message = `No ${noun.one} matches “${query.trim()}”.`;
  }

  let announcement = "";

  if (open) {
    announcement = message || (truncated ? `${countText(matches.length)}, showing the first ${shown.length}` : countText(matches.length));
  }

  const place = useCallback(() => {
    const control = controlRef.current;
    const popup = popupRef.current;

    if (!control || !popup) {
      return;
    }

    const anchor = control.getBoundingClientRect();
    const visible = visibleArea();

    popup.style.minWidth = `${anchor.width}px`;
    popup.style.maxWidth = `${popoverMaxWidth(visible)}px`;
    popup.style.maxHeight = "";

    const placement = popoverPlacement(anchor, {
      width: popup.offsetWidth,
      height: popup.offsetHeight
    }, visible);

    popup.style.top = `${placement.top}px`;
    popup.style.left = `${placement.left}px`;
    popup.style.maxHeight = `${placement.maxHeight}px`;
  }, []);

  // The list joins the top layer, so it neither grows a surrounding dialog nor gets clipped by it or by a scrolling table.
  useLayoutEffect(() => {
    const popup = popupRef.current;

    if (!popup?.showPopover) {
      return;
    }

    const showing = popup.matches(":popover-open");

    if (!open) {
      if (showing) {
        popup.hidePopover();
      }

      return;
    }

    if (!showing) {
      popup.showPopover();
    }

    place();
  }, [open, place, shown.length, message]);

  // It follows the field while a dialog or the page scrolls and while an on-screen keyboard changes the visible area.
  useEffect(() => {
    if (!open) {
      return;
    }

    function placeUnlessListScrolled(event: Event) {
      if (event.target !== listboxRef.current) {
        place();
      }
    }

    const viewport = window.visualViewport;

    document.addEventListener("scroll", placeUnlessListScrolled, true);
    window.addEventListener("resize", place);
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);

    return () => {
      document.removeEventListener("scroll", placeUnlessListScrolled, true);
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [open, place]);

  // Touch browsers keep the field focused when a tap lands on something that cannot take focus, so blurring alone does not close the list.
  useDismiss({
    active: open,
    inside: [controlRef, popupRef],
    onDismiss: () => setOpen(false)
  });

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
      <div ref={controlRef} className={styles["control"]}>
        {selectedIcon && <span className={styles["selected-icon"]}>{selectedIcon}</span>}
        <input
          ref={inputRef}
          id={id}
          className={clsx(styles["input"], selectedIcon && styles["with-icon"])}
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
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
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
      <div ref={popupRef} className={styles["popup"]} popover="manual">
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
        {footer}
      </div>
      <div className={ui["visually-hidden"]} role="status">
        {announcement}
      </div>
    </div>
  );
}
