/** The part of a Navigation API history entry the tab bar needs. */
export type TabHistoryEntry = {
  key: string;
  index: number;
  sameDocument: boolean;
};

/**
 * The entry a tab-bar navigation returns to before it replaces the page: the oldest entry of the current app document that the user can reach by going back without leaving it.
 * Null when the current entry already is that root, so the tab replaces the current entry directly.
 */
export function tabRootEntry(entries: readonly TabHistoryEntry[], currentIndex: number) {
  const byIndex = new Map(entries.map(entry => [entry.index, entry]));
  let root: TabHistoryEntry | null = null;

  for (let index = currentIndex - 1; index >= 0; index--) {
    const entry = byIndex.get(index);

    if (!entry?.sameDocument) {
      break;
    }

    root = entry;
  }

  return root;
}
