/**
 * The one locale for displayed numbers, amounts and dates until users can choose one (#21).
 * British English keeps English copy with day-month dates and the 24-hour clock that European bank statements use; its CLDR number and currency patterns match "en".
 */
export const appLocale = "en-GB";

const countFormat = new Intl.NumberFormat(appLocale);

const percentFormat = new Intl.NumberFormat(appLocale, {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "negative"
});

/** A whole count with grouping, for example 1,234. */
export function formatCount(value: number) {
  return countFormat.format(value);
}

/** A ratio as a whole percentage, for example 0.183 as "18%"; a negative ratio that rounds to zero shows "0%". */
export function formatPercent(ratio: number) {
  return percentFormat.format(ratio);
}
