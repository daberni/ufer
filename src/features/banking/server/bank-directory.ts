// The provider's bank directory changes rarely, so one load serves every dialog for a while; a failed load is not kept, so the next request retries it.

export type CachedLoad<T> = {
  get(): Promise<T>;
  clear(): void;
};

export function cachedLoad<T>(load: () => Promise<T>, lifetimeMs: number, now: () => number = Date.now): CachedLoad<T> {
  let entry: {
    expiresAt: number;
    value: Promise<T>;
  } | null = null;

  return {
    get() {
      if (entry && entry.expiresAt > now()) {
        return entry.value;
      }

      const current = {
        expiresAt: now() + lifetimeMs,
        value: load()
      };

      entry = current;
      current.value.catch(() => {
        if (entry === current) {
          entry = null;
        }
      });

      return current.value;
    },
    clear() {
      entry = null;
    }
  };
}

/** The countries that offer at least one bank, each once and in code order; the dialog names and sorts them in the interface language. */
export function directoryCountries(banks: readonly {
  country: string;
}[]) {
  return [...new Set(banks.map(bank => bank.country))].sort();
}
