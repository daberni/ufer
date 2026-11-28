"use client";

import ui from "./primitives.module.css";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Temporal } from "temporal-polyfill";
import { PeriodPicker, type PickerUnit } from "@/components/ui/period-picker";

type Props = {
  label: string;
  previousLabel: string;
  nextLabel: string;
  /** The unit the picker offers; without one the label is shown as plain text, such as for a custom range. */
  unit: PickerUnit | null;
  selected: Temporal.PlainDate | null;
  onSelect: (start: Temporal.PlainDate) => void;
  onStep: (steps: number) => void;
  /** Disables stepping, such as while all months are selected. */
  stepDisabled?: boolean;
};

/** The period picker shared by the period-aware views: previous and next buttons around a label that opens the picker. */
export function PeriodStepper({
  label,
  previousLabel,
  nextLabel,
  unit,
  selected,
  onSelect,
  onStep,
  stepDisabled = false
}: Props) {
  // A fragment, so each view lays the buttons and the label out in its own grid or row.
  return (
    <>
      <button
        type="button"
        className={ui["icon-button"]}
        aria-label={previousLabel}
        disabled={stepDisabled}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={17} />
      </button>
      {unit ? (
        <PeriodPicker
          unit={unit}
          label={label}
          selected={selected}
          onSelect={onSelect}
        />
      ) : <strong aria-live="polite">{label}</strong>}
      <button
        type="button"
        className={ui["icon-button"]}
        aria-label={nextLabel}
        disabled={stepDisabled}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={17} />
      </button>
    </>
  );
}
