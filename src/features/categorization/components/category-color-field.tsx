"use client";

import { clsx } from "clsx";
import { Palette } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./picker-field.module.css";
import { categoryBarColor, formatHexColor, parseHexColor, suggestedCategoryColors, themedColor } from "@/features/categorization/category-colors";
import { gridNeighbor } from "./grid-navigation";
import { usePickerPanel } from "./use-picker-panel";

type Props = {
  color: string;
  /** A palette color suggested for this category, shown first and marked. */
  suggested?: string | null;
  onChange: (color: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const invalidHexMessage = "Enter a color like #1D9E75";

function isFullHex(input: string) {
  return input.trim().replace(/^#/, "").length === 6;
}

function swatchColor(color: string) {
  return themedColor(scheme => categoryBarColor(color, scheme));
}

// The suggestion for this category leads the palette; the other colors keep their curated order.
function suggestedFirst(suggested: string | null) {
  const match = suggestedCategoryColors.find(suggestion => suggestion.value === suggested);

  if (!match) {
    return suggestedCategoryColors;
  }

  return [match, ...suggestedCategoryColors.filter(suggestion => suggestion !== match)];
}

/** A hex text field with a toggle for a popover of suggested colors. */
export function CategoryColorField({
  color,
  suggested = null,
  onChange,
  open,
  onOpenChange
}: Props) {
  const id = useId();
  const swatchesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hex = formatHexColor(color);
  const [draft, setDraft] = useState(hex);
  const [shownHex, setShownHex] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  const swatches = suggestedFirst(suggested);
  const checkedIndex = swatches.findIndex(suggestion => suggestion.value === hex);
  const {
    fieldRef,
    anchorRef,
    popupRef,
    triggerRef,
    handleKeyDown: handleFieldKeyDown
  } = usePickerPanel({
    open,
    onOpenChange,
    initialFocus: () => swatchesRef.current?.querySelector<HTMLElement>("[tabindex='0']")
  });

  // A color chosen elsewhere, such as a swatch, replaces the text unless the text already means that color.
  if (hex !== shownHex) {
    setShownHex(hex);

    if (parseHexColor(draft) !== hex) {
      setDraft(hex);
      setInvalid(false);
    }
  }

  // While the text is not a color, the category form cannot be submitted with the previous color.
  useEffect(() => {
    inputRef.current?.setCustomValidity(parseHexColor(draft) ? "" : invalidHexMessage);
  }, [draft]);

  function apply() {
    const parsed = parseHexColor(draft);

    if (!parsed) {
      setInvalid(true);

      return;
    }

    setInvalid(false);
    setDraft(parsed);
    onChange(parsed);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter applies the value instead of submitting the category form.
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  }

  function handleSwatchKeyDown(event: KeyboardEvent, index: number) {
    const options = [...(swatchesRef.current?.querySelectorAll<HTMLElement>("[role='radio']") ?? [])];
    const next = gridNeighbor(options, index, event.key);

    if (next === null) {
      return;
    }

    event.preventDefault();
    onChange(swatches[next].value);
    options[next].focus();
  }

  return (
    <div ref={fieldRef} className={styles["field"]} onKeyDown={handleFieldKeyDown}>
      <input type="hidden" name="color" value={color} />
      <label className={styles["field-label"]} htmlFor={`${id}-hex`}>Color</label>
      <div ref={anchorRef} className={clsx(styles["control"], invalid && styles["invalid"])}>
        <span
          className={styles["color-dot"]}
          aria-hidden="true"
          style={{
            background: swatchColor(color)
          }}
        />
        <input
          ref={inputRef}
          id={`${id}-hex`}
          className={styles["hex-input"]}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={16}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={event => {
            setDraft(event.target.value);
            setInvalid(false);

            const parsed = parseHexColor(event.target.value);

            // Typing applies a complete six-digit value right away; shorthand waits for Enter or leaving the field.
            if (parsed && isFullHex(event.target.value)) {
              onChange(parsed);
            }
          }}
          onBlur={apply}
          onInvalid={() => setInvalid(true)}
          onKeyDown={handleInputKeyDown}
        />
        <button
          ref={triggerRef}
          type="button"
          className={styles["toggle"]}
          aria-label="Suggested colors"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => onOpenChange(!open)}
        >
          <Palette size={16} aria-hidden="true" />
        </button>
      </div>
      {invalid && <p id={`${id}-error`} className={styles["hex-error"]} role="alert">{invalidHexMessage}</p>}
      <div
        ref={popupRef}
        id={`${id}-panel`}
        className={styles["popover"]}
        popover="manual"
        role="group"
        aria-label="Suggested colors"
      >
        {open && (
          <div
            ref={swatchesRef}
            className={styles["swatches"]}
            role="radiogroup"
            aria-label="Suggested colors"
          >
            {swatches.map((suggestion, index) => {
              const checked = index === checkedIndex;
              const isSuggestion = suggestion.value === suggested;
              const label = isSuggestion ? `${suggestion.name} (suggested)` : suggestion.name;
              const focusable = checked || (checkedIndex === -1 && index === 0);

              return (
                <button
                  key={suggestion.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={label}
                  title={`${label} ${suggestion.value}`}
                  tabIndex={focusable ? 0 : -1}
                  className={clsx(styles["swatch"], isSuggestion && styles["suggested"])}
                  onClick={() => onChange(suggestion.value)}
                  onKeyDown={event => handleSwatchKeyDown(event, index)}
                >
                  <span
                    className={styles["swatch-color"]}
                    style={{
                      background: swatchColor(suggestion.value)
                    }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
