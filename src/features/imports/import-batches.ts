import { rowCategoryValues, type ImportRow } from "./import-rows";

// Splits import rows into request batches and bounds the duplicate state carried between them.

/** Days a booking date may differ between duplicates: banks and exports disagree between booking and value date, and weekends shift bookings by up to three days. */
export const duplicateDateToleranceDays = 3;

/** Most targets one import request accepts; the server applies the same limit. */
export const maxTargetsPerRequest = 100;

/** Most category choices one import request accepts; the server applies the same limit. */
export const maxCategoryChoicesPerRequest = 1000;

/** Derives an import ID from the file's bytes, shaped as a version 8 UUID: choosing the same file again, for example after signing in anew, resumes its import and reuses the accounts it created. */
export async function importIdFor(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  const hex = [...digest.subarray(0, 16)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const variant = (8 + (parseInt(hex[16], 16) & 3)).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Splits mapped rows into request batches that stay well below hosted request body limits. */
export function batchRows(rows: ImportRow[], maxBytes = 1_000_000, maxRows = 2000, maxSources = maxTargetsPerRequest, maxCategories = maxCategoryChoicesPerRequest) {
  const batches: ImportRow[][] = [];
  let current: ImportRow[] = [];
  let sources = new Set<string>();
  let categories = new Set<string>();
  let size = 0;

  for (const row of rows) {
    const rowSize = JSON.stringify(row).length * 2;
    // Each batch sends only the targets of its own rows, so it may hold at most as many source accounts as a request accepts targets.
    const tooManySources = !sources.has(row.source) && sources.size >= maxSources;
    // Likewise for the category choices of its rows' category values.
    const values = rowCategoryValues(row);
    const added = values.filter(value => !categories.has(value)).length;
    const tooManyCategories = added > 0 && categories.size + added > maxCategories;

    if (current.length > 0 && (size + rowSize > maxBytes || current.length >= maxRows || tooManySources || tooManyCategories)) {
      batches.push(current);
      current = [];
      sources = new Set();
      categories = new Set();
      size = 0;
    }

    current.push(row);
    sources.add(row.source);

    for (const value of values) {
      categories.add(value);
    }

    size += rowSize;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/** An existing booking an earlier batch matched as a duplicate. */
export type ConsumedBooking = {
  account_id: string;
  reference: string;
  date: string;
};

/** At most as many consumed bookings as a request accepts. */
export const maxConsumedPerRequest = 20_000;

/** Largest request body the import endpoint accepts, the server's body limit. */
export const maxImportRequestBytes = 2 * 1024 * 1024;

function utf8Length(value: string) {
  return new TextEncoder().encode(value).length;
}

/** Room for the `consumed` key and its separators in the request body. */
const consumedKeyAllowance = 64;

/** Adds the consumed matches to an import request, with what the request's measured UTF-8 size leaves of the body limit. */
export function withConsumed<T extends object>(request: T, consumed: ConsumedBooking[], earliestDate: string) {
  const budget = maxImportRequestBytes - utf8Length(JSON.stringify(request)) - consumedKeyAllowance;

  return {
    ...request,
    consumed: pruneConsumed(consumed, earliestDate, budget)
  };
}

/**
 * Drops matches that no row of a batch starting at `earliestDate` can reach; with date-sorted batches this keeps the list bounded however large the file is.
 * The list takes at most `maxBytes` serialized and `maxConsumedPerRequest` entries; beyond that it keeps the latest, by date and then by when they were added, so the import still completes and only the dropped rows could absorb a neighbouring row by content.
 */
export function pruneConsumed(consumed: ConsumedBooking[], earliestDate: string, maxBytes: number) {
  const reach = new Date(Date.parse(`${earliestDate}T00:00:00Z`) - duplicateDateToleranceDays * 86_400_000).toISOString().slice(0, 10);
  // Reversing before the stable sort puts the most recently added of equal dates first.
  const latestFirst = consumed.filter(booking => booking.date >= reach).toReversed().toSorted((left, right) => right.date.localeCompare(left.date));
  const kept: ConsumedBooking[] = [];
  let size = 2;

  for (const booking of latestFirst) {
    size += utf8Length(JSON.stringify(booking)) + 1;

    if (size > maxBytes || kept.length >= maxConsumedPerRequest) {
      break;
    }

    kept.push(booking);
  }

  return kept.reverse();
}
