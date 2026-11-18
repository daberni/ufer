"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import { batchRows, type MappedRow, type RowError } from "./csv-mapping";

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
  errors: RowError[];
  unknownCategories: string[];
  toleranceDays: number;
};

type MappedImport = {
  rows: MappedRow[];
  rowErrors: RowError[];
  targets: MappedTarget[];
  confirm: boolean;
};

/** Checks or saves mapped rows in request batches and merges the batch summaries; confirming first creates the requested new accounts. */
export function useMappedImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      rows,
      rowErrors,
      targets,
      confirm
    }: MappedImport) => {
      const resolved = [];

      for (const target of targets) {
        if (target.accountId !== "new") {
          resolved.push({
            source: target.source,
            account_id: target.accountId
          });
        } else if (confirm) {
          const created = await api<{
            id: string;
          }>("imports/mapped/accounts", {
            name: target.name,
            currency: target.currency
          });

          resolved.push({
            source: target.source,
            account_id: created.id
          });
        } else {
          resolved.push({
            source: target.source,
            currency: target.currency
          });
        }
      }

      const summary: MappedImportSummary = {
        confirmed: confirm,
        newRows: 0,
        duplicates: [],
        errors: [...rowErrors],
        unknownCategories: [],
        toleranceDays: 0
      };

      for (const batch of batchRows([...rows].sort((left, right) => left.date.localeCompare(right.date)))) {
        const result = await api<MappedImportSummary>("imports/mapped", {
          rows: batch,
          targets: resolved,
          confirm
        });

        summary.newRows += result.newRows;
        summary.duplicates.push(...result.duplicates);
        summary.errors.push(...result.errors);
        summary.unknownCategories = [...new Set([...summary.unknownCategories, ...result.unknownCategories])].sort();
        summary.toleranceDays = result.toleranceDays;
      }

      summary.errors.sort((left, right) => left.line - right.line);
      summary.duplicates.sort((left, right) => left.line - right.line);

      return summary;
    },
    onSettled: (_data, _error, variables) => variables.confirm ? invalidate(queryClient, affectedKeys) : undefined
  });
}
