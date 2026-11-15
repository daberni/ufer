/** The highest transaction-list page the API serves; the URL and the API request use the same bound. */
export const maxPage = 10_000;

/** Reads a 1-based page from a query value; anything other than a positive integer means the first page. */
export function parsePage(value: string | null) {
  const page = Number(value);

  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }

  return Math.min(page, maxPage);
}
