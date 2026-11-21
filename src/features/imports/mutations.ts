"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { NewImportCategory } from "./import-plan";
import type { AccountKind } from "@/features/accounts/account-kinds";
import { assignOccurrences, duplicateIdErrors, rowCategoryValues, type MappedRow, type RowError } from "./import-rows";
import { batchRows, withConsumed, type ConsumedBooking } from "./import-batches";
import type { DecisionInput, RowMatch } from "./reimport-decisions";

// Confirmed rows and opening balances change account balances.
const affectedKeys = [queryKeys.accounts(), queryKeys.reports.netWorth(), queryKeys.transactions.all(), queryKeys.reports.cashFlow()];

/** Where one source account's rows go: an existing account, or a manual account created on confirmation (`accountId` null). */
export type ImportTarget = {
  source: string;
  accountId: string | null;
  /** The account currency, which decides the rows it accepts. */
  currency: string;
  newAccount: {
    name: string;
    kind: AccountKind;
    opening: OpeningBalanceInput | null;
  } | null;
};

/** A new account's balance today or at the start of the file, booked as an opening balance on `date`. */
export type OpeningBalanceInput = {
  kind: "current" | "start";
  amount: string;
  date: string;
};

/** How the rows' category values map: an existing category, a category created on confirmation, or uncategorized. */
export type CategoryChoice = {
  value: string;
  action: "existing" | "create" | "uncategorized";
  categoryId?: string;
  /** A category created on confirmation, with the icon and color shown for it. */
  newCategory?: NewImportCategory;
};

export type MappedImportSummary = {
  confirmed: boolean;
  /** Rows that are new or decided to be created. */
  newRows: number;
  /** Matched rows whose payee, description or type an update changes. */
  updatedRows: number;
  duplicates: {
    line: number;
    reason: "already_imported" | "existing_booking";
  }[];
  possibleDuplicates: number[];
  /** Possible duplicates without a decision, which the import leaves out. */
  undecided: number[];
  matches: RowMatch[];
  errors: RowError[];
  unknownCategories: string[];
  createdCategories: string[];
  toleranceDays: number;
};

type MappedImport = {
  /** One ID per file import, kept across the check and confirmation retries, so new accounts are created once. */
  importId: string;
  rows: MappedRow[];
  rowErrors: RowError[];
  targets: ImportTarget[];
  categories: CategoryChoice[];
  /** Decisions for matched and possibly duplicate rows, sent with the batch holding each line. */
  decisions: DecisionInput[];
  confirm: boolean;
  /** Called before the first confirmed batch is sent, since a batch can commit even when its response is lost; from then on the import's file, format, mapping and targets are fixed. */
  onConfirmStart?: () => void;
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
      categories,
      decisions,
      confirm,
      onConfirmStart
    }: MappedImport) => {
      const resolved = targets.map(target => target.newAccount ? {
        source: target.source,
        new_account: {
          name: target.newAccount.name.trim(),
          kind: target.newAccount.kind,
          currency: target.currency,
          ...target.newAccount.opening ? {
            opening: target.newAccount.opening
          } : {}
        }
      } : {
        source: target.source,
        account_id: target.accountId
      });
      const categoryChoices = categories.map(choice => ({
        value: choice.value,
        action: choice.action,
        category_id: choice.categoryId,
        ...choice.newCategory
      }));
      const summary: MappedImportSummary = {
        confirmed: confirm,
        newRows: 0,
        updatedRows: 0,
        duplicates: [],
        possibleDuplicates: [],
        undecided: [],
        matches: [],
        errors: [...rowErrors],
        unknownCategories: [],
        createdCategories: [],
        toleranceDays: 0
      };
      let consumed: ConsumedBooking[] = [];

      // Occurrences count per target account, so a reference does not depend on the order or the other accounts in the export.
      const targetOf = (source: string) => {
        const target = targets.find(item => item.source === source);

        return target?.accountId ?? `new:${source}`;
      };
      const currencyOf = (source: string) => targets.find(item => item.source === source)?.currency || null;
      // An ID must identify one row per account; rows sharing one are rejected before anything is sent.
      const idErrors = duplicateIdErrors(rows, targetOf);
      const rejected = new Set(idErrors.map(error => error.line));
      const numbered = assignOccurrences(rows.filter(row => !rejected.has(row.line)), targetOf, currencyOf);

      summary.errors.push(...idErrors);

      if (confirm) {
        onConfirmStart?.();
      }

      const batches = batchRows(numbered.sort((left, right) => left.date.localeCompare(right.date)));

      for (const [index, batch] of batches.entries()) {
        const lines = new Set(batch.map(row => row.line));
        const request = {
          import_id: importId,
          rows: batch,
          targets: resolved.filter(target => batch.some(row => row.source === target.source)),
          categories: categoryChoices.filter(choice => batch.some(row => rowCategoryValues(row).includes(choice.value))),
          decisions: decisions.filter(decision => lines.has(decision.line)),
          confirm,
          final: index === batches.length - 1
        };
        const result = await api<MappedImportSummary & {
          matched: ConsumedBooking[];
        }>("imports/mapped", withConsumed(request, consumed, batch[0].date));

        consumed = [...consumed, ...result.matched];
        summary.newRows += result.newRows;
        summary.updatedRows += result.updatedRows;
        summary.duplicates.push(...result.duplicates);
        summary.possibleDuplicates.push(...result.possibleDuplicates);
        summary.undecided.push(...result.undecided);
        summary.matches.push(...result.matches);
        summary.errors.push(...result.errors);
        summary.unknownCategories = [...new Set([...summary.unknownCategories, ...result.unknownCategories])].sort();
        summary.createdCategories = [...new Set([...summary.createdCategories, ...result.createdCategories])].sort();
        summary.toleranceDays = result.toleranceDays;
      }

      summary.errors.sort((left, right) => left.line - right.line);
      summary.duplicates.sort((left, right) => left.line - right.line);
      summary.possibleDuplicates.sort((left, right) => left - right);
      summary.undecided.sort((left, right) => left - right);
      summary.matches.sort((left, right) => left.line - right.line);

      return summary;
    },
    onSettled: (_data, _error, variables) => variables.confirm ? invalidate(queryClient, [...affectedKeys, queryKeys.categories()]) : undefined
  });
}
