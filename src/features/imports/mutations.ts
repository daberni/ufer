"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";

export type ImportMode = "balances" | "transactions";

type CsvImport = {
  mode: ImportMode;
  accountId: string;
  file: File;
};

const maxFileSize = 1_000_000;

const affectedKeys = {
  balances: [queryKeys.accounts(), queryKeys.reports.netWorth()],
  transactions: [queryKeys.transactions.all(), queryKeys.reports.cashFlow(), queryKeys.accounts()]
};

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
    onSettled: (_data, _error, { mode }) => invalidate(queryClient, affectedKeys[mode])
  });
}
