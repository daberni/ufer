"use client";

import ui from "./primitives.module.css";
import styles from "./searchable-select.module.css";
import { Check, ChevronDown, Plus } from "lucide-react";
import { clsx } from "clsx";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { creatableName, matchOptions, searchableSelectToggleKeyAction, shownOptionLimit } from "./searchable-select-behavior";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useComboboxOptions } from "./use-combobox-options";
import { useDismiss } from "./use-dismiss";
import { useTranslations } from "next-intl";

export type SearchableSelectOption<Value> = {
  key: string;
  value: Value;
  label: string;
  icon?: ReactNode;
  /** Colors the icon and label in the list and in the field while it shows the option, such as a category color. */
  color?: string;
  /** Shown after the label and read with it, such as a status badge. */
  description?: ReactNode;
  /** A muted second line below the label, read with it, such as an example of the option. */
  detail?: ReactNode;
};

export type SearchableSelectAppearance = "default" | "inline";

export type SearchableSelectNoun = "category" | "bank" | "format";

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
  /** Names the options in counts and messages; each noun has its own sentences in the common.select catalog, since languages inflect them differently. */
  noun: SearchableSelectNoun;
  placeholder: string;
  /** Replaces the options with a message, such as a loading, error or empty state. */
  notice?: string;
  busy?: boolean;
  /** Shown below the options while the list is open, such as a note about the choice. */
  footer?: ReactNode;
  /** Status icons inside the field's right edge, before the toggle; the field keeps its width when they appear. */
  adornment?: ReactNode;
  /** An independent action at the end of the field, after its dropdown toggle. */
  endAdornment?: ReactNode;
  /** Inline fields keep their geometry but show chrome only during interaction or an inherited row hover. */
  appearance?: SearchableSelectAppearance;
  /** Sizes the field, such as a denser control for tables and filters. */
  className?: string;
  /** Opens with the first option highlighted and in view instead of the selected one, for a first option that should be seen whenever the list opens. */
  openAtFirst?: boolean;
  /** Offers a last option that creates an option named after the typed text when no option has exactly that label. */
  onCreate?: (name: string) => void;
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
  adornment,
  endAdornment,
  appearance = "default",
  className,
  onCreate,
  openAtFirst = false,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy
}: Props<Value>) {
  const [open, setOpen] = useState(false);
  // While the toggle button has focus, the field's active descendant is not read, so the highlighted option is announced instead.
  const [toggleFocused, setToggleFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Whether the list was open when a press on the toggle began; the field's blur may close it before the click.
  const openAtTogglePress = useRef<boolean | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const t = useTranslations("common.select");
  const selected = options.find(option => Object.is(option.value, value));
  // The selected option's label lists every option again, so another one can be picked without clearing the field first.
  const matches = notice ? [] : match(options, query === selected?.label ? "" : query);
  const shown = matches.slice(0, shownOptionLimit);
  const selectedIndex = shown.findIndex(option => option === selected);
  const createName = onCreate && !notice ? creatableName(options, query) : "";
  const createIndex = createName ? shown.length : -1;
  const optionCount = shown.length + (createName ? 1 : 0);
  const openingIndex = openAtFirst ? 0 : Math.max(selectedIndex, 0);
  const {
    listboxId,
    optionId,
    active,
    setActiveIndex,
    activeDescendant,
    keyState,
    apply,
    handleKeyDown
  } = useComboboxOptions({
    open,
    optionCount,
    // Keys that open the list start where opening by pointer does.
    selectedIndex: openAtFirst ? -1 : selectedIndex,
    listboxRef,
    onOpen: () => setOpen(true),
    onSelect: choose,
    onClose: () => setOpen(false)
  });
  const createLabel = t(`nouns.${noun}.create`, {
    name: createName
  });
  const countText = (count: number) => t(`nouns.${noun}.count`, {
    count
  });
  const truncated = matches.length > shown.length;
  const listLabel = t(`nouns.${noun}.list`);
  // A selection shown as the placeholder hint (an empty field reading "Uncategorized") keeps its icon like one shown as text.
  const showsSelected = selected !== undefined && (query === selected.label || (query === "" && placeholder === selected.label));

  const noMatchText = t(`nouns.${noun}.noMatch`, {
    query: query.trim()
  });
  let message = notice;

  // The create option says enough on its own when nothing matches.
  if (!message && !matches.length && !createName) {
    message = noMatchText;
  }

  let announcement = "";

  if (open && !matches.length) {
    announcement = message || noMatchText;
  } else if (open) {
    announcement = message || (truncated ? t("showingFirst", {
      count: countText(matches.length),
      shown: shown.length
    }) : countText(matches.length));
  }

  if (open && createName) {
    announcement = `${announcement} ${t("createAvailable", {
      label: createLabel
    })}`;
  }

  const activeLabel = active === createIndex ? createLabel : shown[active]?.label;

  if (open && toggleFocused && activeLabel) {
    announcement = t(active === selectedIndex ? "selectedPosition" : "position", {
      label: activeLabel,
      position: active + 1,
      total: optionCount
    });
  }

  // The list joins the top layer, so it neither grows a surrounding dialog nor gets clipped by it or by a scrolling table.
  useAnchoredPopover({
    open,
    anchorRef: controlRef,
    popupRef,
    matchAnchorWidth: true
  });

  // Touch browsers keep the field focused when a tap lands on something that cannot take focus, so blurring alone does not close the list.
  useDismiss({
    active: open,
    inside: [controlRef, popupRef],
    onDismiss: () => setOpen(false)
  });

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function choose(index: number) {
    const option = shown[index];

    setOpen(false);

    if (index === createIndex) {
      onCreate?.(createName);

      return;
    }

    if (option) {
      onChange(option.value);
    }
  }

  function search(text: string) {
    onQueryChange(text);
    // The first match is highlighted, so Enter picks it; the list itself is refiltered from the new text.
    openAt(0);
  }

  // Opening from the button leaves the search field unfocused, so phones do not raise the on-screen keyboard.
  function toggle() {
    const wasOpen = openAtTogglePress.current ?? open;

    openAtTogglePress.current = null;
    toggleRef.current?.focus();

    if (wasOpen) {
      setOpen(false);
    } else {
      openAt(openingIndex);
    }
  }

  function handleToggleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const action = searchableSelectToggleKeyAction(event, keyState);

    if (action.type === "search") {
      event.preventDefault();
      inputRef.current?.focus();
      search(action.text);

      return;
    }

    apply(event, action);
  }

  return (
    <div className={styles["searchable-select"]}>
      <div
        ref={controlRef}
        className={clsx(styles["control"], appearance === "inline" && styles["inline"], className)}
        style={{
          color: showsSelected ? selected.color : undefined
        }}
      >
        {showsSelected && selected.icon && <span className={styles["selected-icon"]}>{selected.icon}</span>}
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
          aria-activedescendant={activeDescendant}
          aria-busy={busy}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          onChange={event => search(event.target.value)}
          onFocus={event => {
            // Typing then replaces the selected option's label instead of extending it.
            if (selected && query === selected.label) {
              event.currentTarget.select();
            }
          }}
          onClick={() => {
            if (!open) {
              openAt(openingIndex);
            }
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
        {adornment}
        <button
          ref={toggleRef}
          type="button"
          className={styles["toggle"]}
          tabIndex={-1}
          aria-label={t(`nouns.${noun}.show`)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onPointerDown={() => {
            openAtTogglePress.current = open;
          }}
          onClick={toggle}
          onKeyDown={handleToggleKeyDown}
          // Space would click the button on release after it already picked an option.
          onKeyUp={event => event.preventDefault()}
          onFocus={() => setToggleFocused(true)}
          onBlur={() => {
            setToggleFocused(false);
            setOpen(false);
          }}
        >
          <ChevronDown aria-hidden="true" strokeWidth={2.2} />
        </button>
        {endAdornment}
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
              style={{
                color: option.color
              }}
              data-active={index === active ? "" : undefined}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              {option.icon}
              <span className={styles["label"]}>
                {option.label}
                {option.detail && <span className={styles["detail"]}>{option.detail}</span>}
              </span>
              {option.description}
              {index === selectedIndex && <Check className={styles["check"]} aria-hidden="true" strokeWidth={2.4} />}
            </li>
          ))}
          {open && createName && (
            <li
              id={optionId(createIndex)}
              className={styles["option"]}
              role="option"
              aria-selected={false}
              data-active={createIndex === active ? "" : undefined}
              onPointerMove={() => setActiveIndex(createIndex)}
              onClick={() => choose(createIndex)}
            >
              <Plus className={styles["create-icon"]} aria-hidden="true" strokeWidth={2.2} />
              <span className={styles["label"]}>{createLabel}</span>
            </li>
          )}
        </ul>
        {message && <p className={styles["message"]}>{message}</p>}
        {!message && truncated && (
          <p className={styles["message"]}>{t("truncated", {
            shown: shown.length,
            count: countText(matches.length)
          })}</p>
        )}
        {footer}
      </div>
      <div className={ui["visually-hidden"]} role="status">
        {announcement}
      </div>
    </div>
  );
}
