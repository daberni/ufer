/** A ratio as a CSS percentage, for example 0.25 as "25%", for sizes and positions; use formatPercent for displayed text. */
export function cssPercent(ratio: number) {
  return `${ratio * 100}%`;
}
