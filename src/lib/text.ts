/** Folds case and strips diacritics, so a search for "cafe" also finds "Café". */
export function searchText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("und");
}
