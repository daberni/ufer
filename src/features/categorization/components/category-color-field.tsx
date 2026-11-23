"use client";

import sparkle from "../../../components/ui/sparkle.module.css";

import { clsx } from "clsx";
import { Palette } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./picker-field.module.css";
import { categoryBarColor, formatHexColor, parseHexColor, suggestedCategoryColors, themedColor, type SuggestedCategoryColor } from "@/features/categorization/category-colors";
import { useTranslations } from "next-intl";
import { gridNeighbor } from "./grid-navigation";
import { usePickerPanel } from "./use-picker-panel";

type Props = {
  color: string;
  /** Shown instead of the color while it is not known yet, such as "Loading…"; the field then submits no color, so the server chooses one. */
  unknownLabel?: string | null;
  /** The palette color similar categories use, highlighted in the palette. */
  suggested?: string | null;
  onChange: (color: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function isFullHex(input: string) {
  return input.trim().replace(/^#/, "").length === 6;
}

function swatchColor(color: string) {
  return themedColor(scheme => categoryBarColor(color, scheme));
}

/** A hex text field with a toggle for a popover of suggested colors. */
export function CategoryColorField({
  color,
  unknownLabel = null,
  suggested = null,
  onChange,
  open,
  onOpenChange
}: Props) {
  const t = useTranslations("categorization.color");
  const invalidHexMessage = t("invalid");
  const id = useId();
  const loading = unknownLabel !== null;
  const swatchesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hex = formatHexColor(color);
  const [draft, setDraft] = useState(hex);
  const [shownHex, setShownHex] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  // A suggestion outside the palette, such as a custom color of similar categories, joins the palette as one more swatch.
  const swatches: SuggestedCategoryColor[] = suggested && !suggestedCategoryColors.some(swatch => swatch.value === suggested) ? [...suggestedCategoryColors, {
    name: "similar",
    value: suggested
  }] : suggestedCategoryColors;
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
    // Opened from the hex text, the panel leaves focus in the text so typing continues.
    initialFocus: () => document.activeElement === inputRef.current ? null : swatchesRef.current?.querySelector<HTMLElement>("[tabindex='0']")
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
  }, [draft, invalidHexMessage]);

  function apply() {
    const parsed = parseHexColor(draft);

    if (!parsed) {
      setInvalid(true);

      return;
    }

    setInvalid(false);
    setDraft(parsed);

    // Leaving the text unchanged is not a choice, so a new category keeps following its suggestion.
    if (parsed !== hex) {
      onChange(parsed);
    }
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
      {!loading && <input type="hidden" name="color" value={color} />}
      <label className={styles["field-label"]} htmlFor={`${id}-hex`}>{t("label")}</label>
      <div ref={anchorRef} className={clsx(styles["control"], invalid && styles["invalid"])}>
        <span
          className={styles["color-dot"]}
          aria-hidden="true"
          style={{
            background: loading ? "transparent" : swatchColor(color)
          }}
        />
        <input
          ref={inputRef}
          id={`${id}-hex`}
          className={styles["hex-input"]}
          value={loading ? "" : draft}
          placeholder={unknownLabel ?? undefined}
          disabled={loading}
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
          onFocus={() => onOpenChange(true)}
          onBlur={apply}
          onInvalid={() => setInvalid(true)}
          onKeyDown={handleInputKeyDown}
        />
        <button
          ref={triggerRef}
          type="button"
          className={clsx(styles["toggle"], suggested && sparkle["sparkle-outline"])}
          aria-label={t("suggestions")}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          disabled={loading}
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
      >
        {open && (
          <div
            ref={swatchesRef}
            className={styles["swatches"]}
            role="radiogroup"
            aria-label={t("suggestions")}
          >
            {swatches.map((suggestion, index) => {
              const checked = index === checkedIndex;
              const isSuggestion = suggestion.value === suggested;
              const name = t(`names.${suggestion.name}`);
              const label = isSuggestion ? t("suggested", {
                name
              }) : name;
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
                  className={styles["swatch"]}
                  onClick={() => onChange(suggestion.value)}
                  onKeyDown={event => handleSwatchKeyDown(event, index)}
                >
                  <span
                    className={clsx(styles["swatch-color"], isSuggestion && sparkle["sparkle"])}
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
