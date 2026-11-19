export function normalizeCategoryName(name: string) {
  return name.trim().normalize("NFC");
}

/** The comparison key for category names: canonically equivalent spellings and letter case compare equal. */
export function categoryNameKey(name: string) {
  return normalizeCategoryName(name).toLocaleLowerCase("und");
}

// SQLite lower() only folds ASCII, so duplicate detection compares names here instead.
export function sameCategoryName(left: string, right: string) {
  return categoryNameKey(left) === categoryNameKey(right);
}
