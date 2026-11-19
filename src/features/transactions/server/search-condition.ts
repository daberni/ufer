// Searches what the list shows: a person's payee and description override the source's text.
const searchedText = "lower(COALESCE(t.counterparty_override,t.counterparty) || ' ' || COALESCE(t.description_override,t.description))";
const asciiOnly = /^[\x00-\x7f]*$/;

// Folds that are not a one-to-one uppercase mapping: ß and ẞ become "ss", Greek final ς becomes σ.
const foldedSequences: [string, string][] = [
  ["ß", "ss"],
  ["ẞ", "ss"],
  ["ς", "σ"]
];

// Each folded letter nests one replace() call and SQLite's parser stack overflows at about 27, so letters beyond this cap match case-sensitively.
const maxFoldedLetters = 16;

/** Unicode lower case with the full case folding of ß and Greek final sigma, so "STRASSE", "Straße" and "STRAẞE" compare equal. */
function foldCase(text: string) {
  return text.normalize("NFC").toLowerCase().replaceAll("ß", "ss").replaceAll("ς", "σ");
}

// The uppercase letter that folds to a lowercase letter of the search term; SQLite lower() already handles ASCII.
function nonAsciiUppercase(letter: string) {
  const uppercase = letter.toUpperCase();
  const isOtherSingleLetter = uppercase !== letter && [...uppercase].length === 1;

  if (!isOtherSingleLetter || asciiOnly.test(uppercase) || foldCase(uppercase) !== letter) {
    return null;
  }

  return uppercase;
}

/**
 * SQL condition on `t` matching a search term in the payee or description regardless of letter case.
 * SQLite and libSQL fold only ASCII letters and hosted libSQL offers no portable Unicode case function, so the stored text is folded in SQL for exactly the non-ASCII letters the term contains.
 */
export function searchCondition(search: string) {
  const term = foldCase(search);
  const replacements = foldedSequences.filter(([, folded]) => term.includes(folded));
  const letterReplacements: [string, string][] = [];

  for (const letter of new Set(term)) {
    const uppercase = nonAsciiUppercase(letter);

    if (uppercase) {
      letterReplacements.push([uppercase, letter]);
    }
  }

  replacements.push(...letterReplacements.slice(0, maxFoldedLetters));

  const foldedText = replacements.reduce(text => `replace(${text},?,?)`, searchedText);

  return {
    sql: `instr(${foldedText},?) > 0`,
    args: [...replacements.flat(), term]
  };
}
