export function normalizeCategoryName(name: string) {
  return name.trim().normalize("NFC");
}

// SQLite lower() only folds ASCII, so duplicate detection compares names here instead.
export function sameCategoryName(left: string, right: string) {
  return normalizeCategoryName(left).toLocaleLowerCase("und") === normalizeCategoryName(right).toLocaleLowerCase("und");
}
