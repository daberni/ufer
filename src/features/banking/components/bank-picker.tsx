"use client";

import ui from "../../../components/ui/primitives.module.css";
import styles from "./bank-picker.module.css";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { bankPickerKeyAction, matchingBanks } from "@/features/banking/bank-picker-behavior";
import type { Bank } from "@/features/dashboard/types";

type Props = {
  id: string;
  banks: readonly Bank[];
  /** The text in the field: a search, or the chosen bank's name. */
  query: string;
  bankName: string;
  loading: boolean;
  error: string;
  onSearch: (query: string) => void;
  onChoose: (bankName: string) => void;
};

function countText(count: number) {
  return count === 1 ? "1 bank" : `${count.toLocaleString("en")} banks`;
}

/** An editable combobox: typing filters the country's banks, and only a bank picked from the list is chosen. */
export function BankPicker({
  id,
  banks,
  query,
  bankName,
  loading,
  error,
  onSearch,
  onChoose
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const errorId = useId();
  // The chosen bank's name lists the whole directory again, so another bank can be picked without clearing the field first.
  const matches = matchingBanks(banks, query === bankName ? "" : query);
  const options = matches.banks;
  const selectedIndex = options.findIndex(bank => bank.name === bankName);
  const active = Math.min(activeIndex, options.length - 1);
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  let message = "";

  if (loading) {
    message = "Loading banks …";
  } else if (error) {
    message = "The bank list could not be loaded.";
  } else if (!banks.length) {
    message = "No personal bank is available for this country.";
  } else if (!matches.total) {
    message = `No bank matches “${query.trim()}”.`;
  }

  let placeholder = "Type to search banks";

  if (loading) {
    placeholder = "Loading banks …";
  } else if (error) {
    placeholder = "Bank list unavailable";
  } else if (!banks.length) {
    placeholder = "No bank available";
  }

  const truncated = matches.total > options.length;
  const resultText = truncated ? `${countText(matches.total)}, showing the first ${options.length}` : countText(matches.total);
  const announcement = open ? message || resultText : "";

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
    const bank = options[index];

    setOpen(false);

    if (bank) {
      onChoose(bank.name);
    }
  }

  function search(text: string) {
    onSearch(text);
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
    const action = bankPickerKeyAction(event, {
      open,
      activeIndex: active,
      selectedIndex,
      optionCount: options.length
    });

    if (action.type === "none") {
      return;
    }

    // Tab still moves focus; the other handled keys must not move the caret, submit the form or close the surrounding dialog.
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
    <div className={styles["picker"]}>
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
          aria-busy={loading}
          aria-describedby={error ? errorId : undefined}
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
          aria-label="Show banks"
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
          aria-label="Banks"
          onMouseDown={event => event.preventDefault()}
        >
          {open && !message && options.map((bank, index) => (
            <li
              key={bank.name}
              id={optionId(index)}
              className={styles["option"]}
              role="option"
              aria-selected={index === selectedIndex}
              data-active={index === active ? "" : undefined}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span className={styles["name"]}>{bank.name}</span>
              {bank.beta && <span className={ui["pill"]}>Beta</span>}
              {index === selectedIndex && <Check className={styles["check"]} aria-hidden="true" strokeWidth={2.4} />}
            </li>
          ))}
        </ul>
        {message && <p className={styles["message"]}>{message}</p>}
        {!message && truncated && <p className={styles["message"]}>Showing the first {options.length} of {countText(matches.total)}. Type to narrow the list.</p>}
      </div>
      {error && <p id={errorId} className={ui["error-text"]}>{error}</p>}
      <div className={ui["visually-hidden"]} role="status">
        {announcement}
      </div>
    </div>
  );
}
