/** Folds case and strips diacritics, so a search for "cafe" also finds "Café". */
export function searchText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("und");
}

/** Lowercase Unicode letters and digits separated by single spaces; punctuation, symbols and diacritics are dropped. */
export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
