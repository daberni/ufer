/** Keeps a proposed keyword short enough to recognize; the person can extend it. */
export const proposedPatternLength = 60;

const word = /^(?=.*\p{L})[^\p{N}]+$/u;
const edgePunctuation = /^[^\p{L}]+|[^\p{L}]+$/gu;

/** Shortens text at a word boundary, so the result is still a prefix of it. */
function limitAtWord(text: string) {
  if (text.length <= proposedPatternLength) {
    return text;
  }

  const cut = text.slice(0, proposedPatternLength + 1);
  const lastSpace = cut.search(/\s+\S*$/);

  return (lastSpace > 0 ? cut.slice(0, lastSpace) : text.slice(0, proposedPatternLength)).trim();
}

/**
 * The longest run of consecutive words in a remittance text, as written there. Tokens with digits, such as card numbers, dates and references, end a
 * run, since they differ between bookings from the same merchant.
 */
function longestWordRun(description: string) {
  let longest = "";
  let runStart = -1;
  let runEnd = -1;

  function closeRun() {
    const run = runStart < 0 ? "" : description.slice(runStart, runEnd).replace(edgePunctuation, "");

    if (run.length > longest.length) {
      longest = run;
    }

    runStart = -1;
  }

  for (const token of description.matchAll(/\S+/g)) {
    if (!word.test(token[0])) {
      closeRun();
      continue;
    }

    if (runStart < 0) {
      runStart = token.index;
    }

    runEnd = token.index + token[0].length;
  }

  closeRun();

  return longest;
}

/**
 * A keyword for a rule learned from one transaction: the payee or, without one, the most distinctive words of the description. The proposal is a
 * substring of the text that keyword rules match, so it always matches the transaction it came from.
 */
export function proposeRulePattern(counterparty: string, description: string) {
  const payee = counterparty.trim();

  if (payee) {
    return limitAtWord(payee);
  }

  return limitAtWord(longestWordRun(description) || description.trim());
}
