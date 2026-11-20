"use client";

import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./picker-field.module.css";
import { categoryBarColor, formatHexColor, parseHexColor, suggestedCategoryColors, themedColor } from "@/features/categorization/category-colors";
import { gridNeighbor } from "./grid-navigation";
import { usePickerPanel } from "./use-picker-panel";

type Props = {
  color: string;
  onChange: (color: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const copiedFeedbackMs = 1500;

function isFullHex(input: string) {
  return input.trim().replace(/^#/, "").length === 6;
}

function swatchColor(color: string) {
  return themedColor(scheme => categoryBarColor(color, scheme));
}

export function CategoryColorField({
  color,
  onChange,
  open,
  onOpenChange
}: Props) {
  const id = useId();
  const swatchesRef = useRef<HTMLDivElement>(null);
  const hex = formatHexColor(color);
  const checkedIndex = suggestedCategoryColors.findIndex(suggestion => suggestion.value === hex);
  const {
    fieldRef,
    triggerRef,
    handleKeyDown: handleFieldKeyDown
  } = usePickerPanel({
    open,
    onOpenChange,
    initialFocus: () => swatchesRef.current?.querySelector<HTMLElement>("[tabindex='0']")
  });

  function handleSwatchKeyDown(event: KeyboardEvent, index: number) {
    const options = [...(swatchesRef.current?.querySelectorAll<HTMLElement>("[role='radio']") ?? [])];
    const next = gridNeighbor(options, index, event.key);

    if (next === null) {
      return;
    }

    event.preventDefault();
    onChange(suggestedCategoryColors[next].value);
    options[next].focus();
  }

  return (
    <div ref={fieldRef} className={styles["field"]} onKeyDown={handleFieldKeyDown}>
      <input type="hidden" name="color" value={color} />
      <span className={styles["field-label"]} id={`${id}-label`}>Color</span>
      <button
        ref={triggerRef}
        type="button"
        className={styles["trigger"]}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => onOpenChange(!open)}
      >
        <span
          className={styles["color-dot"]}
          aria-hidden="true"
          style={{
            background: swatchColor(color)
          }}
        />
        <span id={`${id}-value`} className={styles["trigger-value"]}>{hex}</span>
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className={styles["panel"]}
          role="group"
          aria-label="Choose a color"
        >
          <span className={styles["panel-heading"]} id={`${id}-suggested`}>Suggested</span>
          <div
            ref={swatchesRef}
            className={styles["swatches"]}
            role="radiogroup"
            aria-labelledby={`${id}-suggested`}
          >
            {suggestedCategoryColors.map((suggestion, index) => {
              const checked = index === checkedIndex;
              const focusable = checked || (checkedIndex === -1 && index === 0);

              return (
                <button
                  key={suggestion.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={suggestion.name}
                  title={`${suggestion.name} ${suggestion.value}`}
                  tabIndex={focusable ? 0 : -1}
                  className={styles["swatch"]}
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
          <HexInput hex={hex} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

type HexInputProps = {
  hex: string;
  onChange: (color: string) => void;
};

function HexInput({
  hex,
  onChange
}: HexInputProps) {
  const id = useId();
  const [draft, setDraft] = useState(hex);
  const [shownHex, setShownHex] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);

  // A color chosen elsewhere, such as a swatch, replaces the text unless the text already means that color.
  if (hex !== shownHex) {
    setShownHex(hex);

    if (parseHexColor(draft) !== hex) {
      setDraft(hex);
      setInvalid(false);
    }
  }

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), copiedFeedbackMs);

    return () => window.clearTimeout(timeout);
  }, [copied]);

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

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter applies the value instead of submitting the category form.
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles["hex-row"]}>
      <label className={styles["hex-label"]} htmlFor={`${id}-hex`}>Hex</label>
      <input
        id={`${id}-hex`}
        className={clsx(styles["hex-input"], invalid && styles["invalid"])}
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
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={styles["copy-button"]}
        aria-label={copied ? "Copied" : "Copy hex value"}
        title="Copy hex value"
        onClick={copy}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      </button>
      {invalid && <p id={`${id}-error`} className={styles["hex-error"]} role="alert">Enter a color like #1D9E75</p>}
    </div>
  );
}
