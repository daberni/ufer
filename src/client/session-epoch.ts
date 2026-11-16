let epoch = 0;

/**
 * Counts ended sessions. A request started in an earlier session must not act on its late result, for example by leaving the sign-in screen for a bank's consent page.
 */
export function sessionEpoch() {
  return epoch;
}

export function endSessionEpoch() {
  epoch += 1;
}
