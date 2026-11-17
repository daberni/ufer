/** Transactions per list page, shared by the API and the pagination controls. */
export const transactionPageSize = 50;

/** The highest transaction-list page the API serves; the URL and the API request use the same bound. */
export const maxPage = 10_000;

/** The last page that contains results; an empty result still has page 1. */
export function lastPage(transactionCount: number) {
  return Math.max(1, Math.ceil(transactionCount / transactionPageSize));
}

/** Reads a 1-based page from a query value; anything other than a positive integer means the first page. */
export function parsePage(value: string | null) {
  const page = Number(value);

  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }

  return Math.min(page, maxPage);
}
