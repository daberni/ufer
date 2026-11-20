/** The most parts one booking can be split into. */
export const maximumSplitParts = 50;

/** The largest absolute part in minor units; with at most `maximumSplitParts` parts their sum stays a safe integer, so plain arithmetic adds them exactly. */
export const maximumPartAmount = Math.floor(Number.MAX_SAFE_INTEGER / maximumSplitParts);

/** Whether a part's amount in minor units is within the supported range. */
export function partAmountSupported(amount: number) {
  return Math.abs(amount) <= maximumPartAmount;
}
