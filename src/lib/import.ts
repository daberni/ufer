import { parse } from "csv-parse/sync";
import { minorUnits, validDate } from "./money";
import { HttpError } from "./security";
import type { Entry } from "./store";

export function parseBalancesCsv(text: string, currency: string) {
  if (Buffer.byteLength(text, "utf8") > 1_000_000) throw new HttpError(413, "CSV files cannot exceed 1 MB.");
  let rows: Record<string, string>[];
  try { rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: true, delimiter: text.split(/\r?\n/)[0].includes(";") ? ";" : ",", max_record_size: 20_000 }); }
  catch { throw new HttpError(422, "Could not read CSV. Expected date,balance,currency."); }
  if (!rows.length || rows.length > 10_000) throw new HttpError(422, "CSV must contain between 1 and 10,000 balances.");
  const dates = new Set<string>();
  return rows.map((row, index) => {
    if (!validDate(row.date || "") || row.date > new Date().toISOString().slice(0, 10) || !row.balance || row.currency !== currency) throw new HttpError(422, `CSV row ${index + 2}: invalid date, balance, or account currency.`);
    if (dates.has(row.date)) throw new HttpError(422, `CSV row ${index + 2}: multiple balances have the same date.`);
    dates.add(row.date);
    return { date: row.date, amount: minorUnits(row.balance.replace(",", "."), currency) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function parseTransactionsCsv(text: string, currency: string): Entry[] {
  if (Buffer.byteLength(text, "utf8") > 1_000_000) throw new HttpError(413, "CSV files cannot exceed 1 MB.");
  const header = text.split(/\r?\n/)[0];
  let rows: Record<string, string>[];
  try { rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: true, delimiter: header.includes(";") ? ";" : ",", max_record_size: 20_000 }); }
  catch { throw new HttpError(422, "Could not read CSV. Expected id,date,amount,currency,counterparty,description."); }
  if (!rows.length || rows.length > 10_000) throw new HttpError(422, "CSV must contain between 1 and 10,000 transactions.");
  const references = new Set<string>();
  return rows.map((row, index) => {
    if (!row.id || row.id.length > 200 || !validDate(row.date || "") || !row.amount || row.currency !== currency) throw new HttpError(422, `CSV row ${index + 2}: id, ISO date, amount, or account currency is missing or invalid.`);
    if (references.has(row.id)) throw new HttpError(422, `CSV row ${index + 2}: duplicate ID.`);
    references.add(row.id);
    return { reference: `csv:${row.id}`, date: row.date, amount: minorUnits(row.amount.replace(",", "."), currency), currency, counterparty: (row.counterparty || "").slice(0, 500), description: (row.description || "").slice(0, 2000) };
  });
}
