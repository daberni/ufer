/** Where a chart's values land on its vertical axis, in plot units that grow downwards. */
export type ValueBand = {
  /** The position of the highest value. */
  top: number;
  /** The position of the lowest value. */
  base: number;
  /** The position of every value when they are all equal. */
  flat: number;
};

export type ValueScale = {
  lowest: number;
  highest: number;
  y: (value: number) => number;
  /** The position of value 0 when the values lie on both sides of it; otherwise null and the chart keeps its padded base. */
  zero: number | null;
};

/** A min–max scale of `values` onto `band`, reporting the zero level only when the series crosses zero. */
export function valueScale(values: number[], band: ValueBand): ValueScale {
  const lowest = values.length ? Math.min(...values) : 0;
  const highest = values.length ? Math.max(...values) : 0;
  const range = highest - lowest;
  const y = (value: number) => range ? band.top + (highest - value) / range * (band.base - band.top) : band.flat;
  const crossesZero = lowest < 0 && highest > 0;

  return {
    lowest,
    highest,
    y,
    zero: crossesZero ? y(0) : null
  };
}
