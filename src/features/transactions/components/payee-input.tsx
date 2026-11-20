"use client";

import styles from "./payee-input.module.css";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { useAnchoredPopover } from "@/components/ui/use-anchored-popover";
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
  const listboxId = useId();
  const [query, setQuery] = useState(defaultValue);
  // The text suggestions were last requested for; it follows typing once typing pauses.
  const [requested, setRequested] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = usePayeeSuggestions(open ? requested : "");
  // Suggestions only show for the text in the field, so results for earlier text cannot overwrite newer typing.
  const shown = open && query === requested ? suggestions.data?.payees ?? [] : [];
  const expanded = shown.length > 0;
  const active = Math.min(activeIndex, shown.length - 1);
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    if (query === requested) {
      return;
    }

    const timer = setTimeout(() => setRequested(query), commitDelay);

    return () => clearTimeout(timer);
  }, [query, requested]);

  useLayoutEffect(() => {
    if (expanded && input.current && popupRef.current) {
      popupRef.current.style.minWidth = `${input.current.offsetWidth}px`;
    }
  });

  useAnchoredPopover({
    open: expanded,
    anchorRef: input,
    popupRef
  });

  // Touch browsers keep the field focused when a tap lands on something that cannot take focus, so blurring alone does not close the list.
  useDismiss({
    active: expanded,
    inside: [input, popupRef],
    onDismiss: () => setOpen(false)
  });

  function close() {
    setOpen(false);
    setActiveIndex(-1);
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

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!expanded) {
      return;
    }

    const handled = ["ArrowDown", "ArrowUp", "Escape"].includes(event.key) || (event.key === "Enter" && active >= 0);

    if (!handled) {
      if (event.key === "Tab") {
        close();
      }

      return;
    }

    // These keys must not move the caret, submit the form or close a surrounding dialog.
    event.preventDefault();
    event.stopPropagation();

    switch (event.key) {
      case "ArrowDown":
        setActiveIndex(active + 1 < shown.length ? active + 1 : 0);
        break;
      case "ArrowUp":
        setActiveIndex(active > 0 ? active - 1 : shown.length - 1);
        break;
      case "Enter":
        pick(shown[active]);
        break;
      case "Escape":
        close();
        break;
    }
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
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-describedby={ariaDescribedBy}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
            onValueChange?.(event.target.value);
          }}
          onBlur={close}
          onKeyDown={handleKeyDown}
        />
      </label>
      <div ref={popupRef} className={styles["popup"]} popover="manual">
        <ul
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
              {payee}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
