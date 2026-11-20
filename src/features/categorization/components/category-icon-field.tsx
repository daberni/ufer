"use client";

import sparkle from "../../../components/ui/sparkle.module.css";

import { clsx } from "clsx";
import { Search, X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./picker-field.module.css";
import { categoryIconGroups, categoryIconKeys, categoryIcons, matchesCategoryIconSearch, type CategoryIconGroup, type CategoryIconKey } from "@/features/categorization/category-icons";
import { categoryBarColor, categoryChipColors, categoryGlyphColor, themedColor, themedColors } from "@/features/categorization/category-colors";
import { categoryIconComponents } from "./category-icon-components";
import { gridNeighbor } from "./grid-navigation";
import { usePickerPanel } from "./use-picker-panel";

type IconChoice = CategoryIconKey | "";

type Props = {
  color: string;
  icon: IconChoice;
  /** The icon the category name suggests, highlighted in the picker. */
  suggested?: CategoryIconKey | null;
  onChange: (icon: IconChoice) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const groupKeys = Object.keys(categoryIconGroups) as CategoryIconGroup[];

function iconLabel(icon: IconChoice) {
  return icon === "" ? "No icon" : categoryIcons[icon].label;
}

export function CategoryIconField({
  color,
  icon,
  suggested = null,
  onChange,
  open,
  onOpenChange
}: Props) {
  const id = useId();
  const optionsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const {
    fieldRef,
    anchorRef,
    popupRef,
    triggerRef,
    close: closePanel,
    handleKeyDown: handleFieldKeyDown
  } = usePickerPanel({
    open,
    onOpenChange: next => {
      setSearch("");
      onOpenChange(next);
    },
    initialFocus: () => optionsRef.current?.querySelector<HTMLElement>("[tabindex='0']")
  });
  const TriggerIcon = icon === "" ? null : categoryIconComponents[icon];
  const { foreground: iconColor } = themedColors(scheme => categoryChipColors(color, scheme));
  const matches = categoryIconKeys.filter(key => matchesCategoryIconSearch(key, search));
  const searching = search.trim() !== "";
  const visibleChoices: IconChoice[] = searching ? matches : ["", ...categoryIconKeys];
  const focusableChoice = visibleChoices.includes(icon) ? icon : visibleChoices[0];

  function options() {
    return [...(optionsRef.current?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
  }

  function choose(choice: IconChoice) {
    onChange(choice);
    closePanel();
    setSearch("");
  }

  function handleOptionKeyDown(event: KeyboardEvent) {
    const all = options();
    const index = all.indexOf(event.currentTarget as HTMLElement);
    const next = gridNeighbor(all, index, event.key);

    if (next === null) {
      return;
    }

    event.preventDefault();
    all[next].focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      options()[0]?.focus();
    }

    // Enter picks the only match instead of submitting the category form.
    if (event.key === "Enter") {
      event.preventDefault();

      if (matches.length === 1) {
        choose(matches[0]);
      }
    }
  }

  function renderOption(choice: IconChoice) {
    const Icon = choice === "" ? null : categoryIconComponents[choice];
    const isSuggestion = choice !== "" && choice === suggested;
    const label = isSuggestion ? `${iconLabel(choice)} (suggested)` : iconLabel(choice);

    return (
      <button
        key={choice || "none"}
        type="button"
        role="option"
        aria-selected={choice === icon}
        aria-label={label}
        title={label}
        tabIndex={choice === focusableChoice ? 0 : -1}
        className={clsx(styles["icon-option"], isSuggestion && sparkle["sparkle"])}
        onClick={() => choose(choice)}
        onKeyDown={handleOptionKeyDown}
      >
        {Icon ? (
          <Icon
            aria-hidden="true"
            size={18}
            style={{
              color: iconColor
            }}
          />
        ) : (
          <span
            className={styles["no-icon"]}
            aria-hidden="true"
            style={{
              background: iconColor
            }}
          />
        )}
      </button>
    );
  }

  return (
    <div ref={fieldRef} className={styles["field"]} onKeyDown={handleFieldKeyDown}>
      <input type="hidden" name="icon" value={icon} />
      <span className={styles["field-label"]} aria-hidden="true">Icon</span>
      <div ref={anchorRef} className={styles["icon-anchor"]}>
        <button
          ref={triggerRef}
          type="button"
          className={clsx(styles["control"], styles["icon-trigger"], suggested && sparkle["sparkle-outline"])}
          aria-label={icon === "" ? "Icon: No icon" : `Icon: ${iconLabel(icon)}`}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => {
            setSearch("");
            onOpenChange(!open);
          }}
        >
          <span
            className={styles["icon-preview"]}
            aria-hidden="true"
            style={{
              background: themedColor(scheme => categoryBarColor(color, scheme)),
              color: themedColor(scheme => categoryGlyphColor(color, scheme))
            }}
          >
            {TriggerIcon && <TriggerIcon size={16} />}
          </span>
        </button>
      </div>
      <div
        ref={popupRef}
        id={`${id}-panel`}
        className={clsx(styles["popover"], styles["icon-popover"])}
        popover="manual"
        role="group"
        aria-label="Choose an icon"
      >
        {open && (
          <>
            <label className={styles["search"]}>
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search icons"
                aria-label="Search icons"
                aria-controls={`${id}-options`}
                autoComplete="off"
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              {search !== "" && (
                <button
                  type="button"
                  className={styles["clear-search"]}
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    searchRef.current?.focus();
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </label>
            <div
              ref={optionsRef}
              id={`${id}-options`}
              className={styles["icon-options"]}
              role="listbox"
              aria-label="Icons"
            >
              {searching ? (
                <div className={styles["icon-grid"]}>{matches.map(renderOption)}</div>
              ) : (
                <>
                  <div className={styles["icon-grid"]}>{renderOption("")}</div>
                  {groupKeys.map(group => (
                    <div key={group} role="group" aria-labelledby={`${id}-${group}`}>
                      <span className={styles["group-heading"]} id={`${id}-${group}`}>{categoryIconGroups[group]}</span>
                      <div className={styles["icon-grid"]}>
                        {categoryIconKeys.filter(key => categoryIcons[key].group === group).map(renderOption)}
                      </div>
                    </div>
                  ))}
                </>
              )}
              {searching && matches.length === 0 && <p className={styles["empty"]}>No icons match “{search.trim()}”.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
