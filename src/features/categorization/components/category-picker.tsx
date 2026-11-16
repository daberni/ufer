"use client";

import chipStyles from "./category-chip.module.css";
import styles from "./category-picker.module.css";
import { clsx } from "clsx";
import { Check, ChevronDown, Pin } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { pickerKeyAction, popoverPlacement, typeaheadIndex } from "@/features/categorization/category-picker-behavior";
import { CategoryChip, manualAssignmentHint, type CategoryChipSize, type ChipCategory, type NeutralChip } from "./category-chip";

export type PickerCategory = ChipCategory & {
  id: string;
};

/** Chooses "All categories" in a filter, as opposed to null for "Uncategorized". */
export const anyCategory: unique symbol = Symbol("any category");

export type CategoryPickerValue = string | null | typeof anyCategory;

type ValueProps = {
  includeAll?: false;
  value: string | null;
  onChange: (categoryId: string | null) => void;
} | {
  /** Offers "All categories" first, chosen by anyCategory; for filters. */
  includeAll: true;
  value: CategoryPickerValue;
  onChange: (value: CategoryPickerValue) => void;
};

type Props = ValueProps & {
  categories: readonly PickerCategory[];
  /** Offers "Uncategorized", chosen by null. */
  includeUncategorized?: boolean;
  manual?: boolean;
  disabled?: boolean;
  size?: CategoryChipSize;
  /** Submits the chosen category ID with a surrounding form. */
  name?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
};

type Option = {
  key: string;
  value: CategoryPickerValue;
  chip: ChipCategory | NeutralChip;
  label: string;
};

function pickerOptions(categories: readonly PickerCategory[], includeAll: boolean, includeUncategorized: boolean) {
  const options: Option[] = [];

  if (includeAll) {
    options.push({
      key: "all-categories",
      value: anyCategory,
      chip: "all-categories",
      label: "All categories"
    });
  }

  if (includeUncategorized) {
    options.push({
      key: "uncategorized",
      value: null,
      chip: "uncategorized",
      label: "Uncategorized"
    });
  }

  for (const category of categories) {
    options.push({
      key: category.id,
      value: category.id,
      chip: category,
      label: category.name
    });
  }

  return options;
}

const typeaheadResetMs = 500;

/**
 * A select-only combobox whose closed control and options are category chips.
 * Disabled uses aria-disabled so the control keeps keyboard focus while the change it just made is being saved.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  includeAll = false,
  includeUncategorized = false,
  manual = false,
  disabled = false,
  size = "small",
  name,
  id,
  "aria-label": ariaLabel,
  className
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef({
    query: "",
    timeout: 0
  });
  const listboxId = useId();
  const noteId = useId();
  const options = pickerOptions(categories, includeAll, includeUncategorized);
  const labels = options.map(option => option.label);
  const selectedIndex = options.findIndex(option => option.value === value);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;

    if (!trigger || !popover) {
      return;
    }

    const anchor = trigger.getBoundingClientRect();

    popover.style.minWidth = `${anchor.width}px`;
    popover.style.maxHeight = "";

    const placement = popoverPlacement(anchor, {
      width: popover.offsetWidth,
      height: popover.offsetHeight
    }, {
      width: document.documentElement.clientWidth,
      height: window.innerHeight
    });

    popover.style.top = `${placement.top}px`;
    popover.style.left = `${placement.left}px`;
    popover.style.maxHeight = `${placement.maxHeight}px`;
  }, []);

  // The popover joins the top layer, so table overflow and modal dialogs neither clip nor cover it.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    popoverRef.current?.showPopover?.();
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePopover = popoverRef.current?.contains(target);

      if (!insideTrigger && !insidePopover) {
        setOpen(false);
      }
    }

    function placeUnlessListScrolled(event: Event) {
      if (event.target !== listboxRef.current) {
        place();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("scroll", placeUnlessListScrolled, true);
    window.addEventListener("resize", place);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("scroll", placeUnlessListScrolled, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (open) {
      listboxRef.current?.querySelector("[data-active]")?.scrollIntoView({
        block: "nearest"
      });
    }
  }, [open, activeIndex]);

  if (open && disabled) {
    setOpen(false);
  }

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
    triggerRef.current?.focus();
  }

  function toggle() {
    if (open) {
      setOpen(false);
    } else if (!disabled) {
      openAt(Math.max(selectedIndex, 0));
    }
  }

  function choose(index: number) {
    const option = options[index];

    setOpen(false);
    triggerRef.current?.focus();

    if (option && option.value !== value) {
      // The offered values always match the onChange variant that includeAll selects.
      (onChange as (next: CategoryPickerValue) => void)(option.value);
    }
  }

  function typeahead(character: string) {
    const typing = typeaheadRef.current;
    const startIndex = open ? activeIndex : Math.max(selectedIndex, 0);

    window.clearTimeout(typing.timeout);
    typing.query += character;
    typing.timeout = window.setTimeout(() => {
      typing.query = "";
    }, typeaheadResetMs);

    const match = typeaheadIndex(labels, typing.query, startIndex);

    if (!open) {
      openAt(match >= 0 ? match : startIndex);

      return;
    }

    if (match >= 0) {
      setActiveIndex(match);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    const action = pickerKeyAction(event, {
      open,
      activeIndex,
      selectedIndex,
      optionCount: options.length,
      typing: typeaheadRef.current.query !== ""
    });

    if (action.type === "none") {
      return;
    }

    // Tab still moves focus; every other handled key must not scroll the page, click the button or close a surrounding dialog.
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
        choose(activeIndex);
        break;
      case "close":
        setOpen(false);
        break;
      case "typeahead":
        typeahead(action.character);
        break;
    }
  }

  const optionId = (index: number) => `${listboxId}-option-${index}`;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className={clsx(chipStyles["chip-button"], styles["trigger"], className)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-disabled={disabled || undefined}
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <CategoryChip category={options[selectedIndex]?.chip ?? "uncategorized"} size={size} manual={manual}>
          <ChevronDown className={styles["chevron"]} aria-hidden="true" strokeWidth={2.2} />
        </CategoryChip>
      </button>
      {name && <input type="hidden" name={name} value={typeof value === "string" ? value : ""} />}
      {open && (
        <div ref={popoverRef} className={styles["popover"]} popover="manual">
          <ul
            ref={listboxRef}
            id={listboxId}
            className={styles["listbox"]}
            role="listbox"
            aria-label="Categories"
            aria-describedby={manual ? noteId : undefined}
            onMouseDown={event => event.preventDefault()}
          >
            {options.map((option, index) => (
              <li
                key={option.key}
                id={optionId(index)}
                className={styles["option"]}
                role="option"
                aria-selected={index === selectedIndex}
                data-active={index === activeIndex ? "" : undefined}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                <CategoryChip category={option.chip} size={size} />
                {index === selectedIndex && <Check className={styles["check"]} aria-hidden="true" strokeWidth={2.4} />}
              </li>
            ))}
          </ul>
          {manual && (
            <p id={noteId} className={styles["note"]}>
              <Pin className={styles["note-icon"]} aria-hidden="true" strokeWidth={2.2} />
              {manualAssignmentHint}.
            </p>
          )}
        </div>
      )}
    </>
  );
}
