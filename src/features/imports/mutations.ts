"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import { batchRows, pruneConsumed, type ConsumedBooking, type MappedRow, type RowError } from "./csv-mapping";

export type ImportMode = "mapped" | "balances" | "transactions";

type CsvImport = {
  mode: Exclude<ImportMode, "mapped">;
  accountId: string;
  file: File;
};

const maxFileSize = 1_000_000;

// Both imports book transactions on a manual account, which change its balance.
const affectedKeys = [queryKeys.accounts(), queryKeys.reports.netWorth(), queryKeys.transactions.all(), queryKeys.reports.cashFlow()];

export function useCsvImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      mode,
      accountId,
      file
    }: CsvImport) => {
      if (file.size > maxFileSize) {
        throw new Error("The file cannot exceed 1 MB.");
      }

      return api(`imports/${mode}`, {
        account_id: accountId,
        csv: await file.text()
      });
    },
    onSettled: () => invalidate(queryClient, affectedKeys)
  });
}

export type MappedTarget = {
  source: string;
  /** An existing account, or "new" to create a manual account named `name` on confirmation. */
  accountId: string;
  name: string;
  currency: string;
};

export type MappedImportSummary = {
  confirmed: boolean;
  newRows: number;
  duplicates: {
    line: number;
    reason: "already_imported" | "existing_booking";
  }[];
  possibleDuplicates: number[];
  errors: RowError[];
  unknownCategories: string[];
  toleranceDays: number;
};

type MappedImport = {
  /** One ID per file import, kept across the check and confirmation retries, so new accounts are created once. */
  importId: string;
  rows: MappedRow[];
  rowErrors: RowError[];
  targets: MappedTarget[];
  confirm: boolean;
};

/** Checks or saves mapped rows in request batches and merges the batch summaries. The server creates new accounts with the first confirmed batch. */
export function useMappedImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      importId,
      rows,
      rowErrors,
      targets,
      confirm
    }: MappedImport) => {
      const resolved = targets.map(target => target.accountId === "new" ? {
        source: target.source,
        new_account: {
          name: target.name.trim(),
          currency: target.currency
        }
      } : {
        source: target.source,
        account_id: target.accountId
      });
      const summary: MappedImportSummary = {
        confirmed: confirm,
        newRows: 0,
        duplicates: [],
        possibleDuplicates: [],
        errors: [...rowErrors],
        unknownCategories: [],
        toleranceDays: 0
      };
      let consumed: ConsumedBooking[] = [];

      for (const batch of batchRows([...rows].sort((left, right) => left.date.localeCompare(right.date)))) {
        const result = await api<MappedImportSummary & {
          matched: ConsumedBooking[];
        }>("imports/mapped", {
          import_id: importId,
          rows: batch,
          targets: resolved,
          consumed: pruneConsumed(consumed, batch[0].date),
          confirm
        });

        consumed = [...consumed, ...result.matched];
        summary.newRows += result.newRows;
        summary.duplicates.push(...result.duplicates);
        summary.possibleDuplicates.push(...result.possibleDuplicates);
        summary.errors.push(...result.errors);
        summary.unknownCategories = [...new Set([...summary.unknownCategories, ...result.unknownCategories])].sort();
        summary.toleranceDays = result.toleranceDays;
      }

      summary.errors.sort((left, right) => left.line - right.line);
      summary.duplicates.sort((left, right) => left.line - right.line);
      summary.possibleDuplicates.sort((left, right) => left - right);

      return summary;
    },
    onSettled: (_data, _error, variables) => variables.confirm ? invalidate(queryClient, affectedKeys) : undefined
  });
}
