"use client";

import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { Category, Rule } from "@/features/dashboard/types";

type CategoryDetails = Record<string, FormDataEntryValue>;

/** Creates a category, or updates one; rules and the spending breakdown show a category's name, color and icon. */
export function useSaveCategory(category?: Category | null) {
  const queryClient = useQueryClient();
  const affected = category ? [queryKeys.categories(), queryKeys.rules(), queryKeys.reports.cashFlow()] : [queryKeys.categories()];

  return useMutation({
    // Resolves to the saved category's id.
    mutationFn: async (details: CategoryDetails) => {
      if (category) {
        await api(`categories/${encodeURIComponent(category.id)}`, details, "PATCH");

        return category.id;
      }

      const created = await api<{
        id: string;
      }>("categories", details);

      return created.id;
    },
    onSettled: () => invalidate(queryClient, affected)
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rule: Record<string, unknown>) => api("rules", rule),
    onSettled: () => invalidate(queryClient, [queryKeys.rules()])
  });
}

const toggleRuleKey = ["rules", "toggle"] as const;

export function useToggleRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: toggleRuleKey,
    mutationFn: (rule: Rule) => api(`rules/${encodeURIComponent(rule.id)}`, {
      enabled: !rule.enabled
    }, "PATCH"),
    onSettled: () => invalidate(queryClient, [queryKeys.rules()])
  });
}

/** Rules whose enabled state is being saved; each switch waits only for its own change. */
export function useTogglingRules() {
  return useMutationState({
    filters: {
      mutationKey: toggleRuleKey,
      status: "pending"
    },
    select: mutation => (mutation.state.variables as Rule).id
  });
}

/** Re-categorizes every transaction without a manual assignment, which changes lists and spending. */
export function useApplyRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api("rules/apply", {}),
    onSettled: () => invalidate(queryClient, [queryKeys.transactions.all(), queryKeys.reports.cashFlow()])
  });
}
