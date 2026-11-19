"use client";

import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { Category, Rule } from "@/features/categorization/types";
import { withOrderedPriorities } from "@/features/categorization/rule-order";

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

export type CreatedRule = {
  ok: true;
  /** Uncategorized transactions that received the rule's category when it was created. */
  categorized: number;
};

/** Creates a rule; applying it to uncategorized transactions also changes lists and spending. */
export function useCreateRuleFromAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rule: Record<string, unknown>) => api<CreatedRule>("rules", rule),
    onSettled: (_result, _error, rule) => {
      const affected = rule.apply_to_uncategorized === true ? [queryKeys.rules(), queryKeys.transactions.all(), queryKeys.reports.cashFlow()] : [queryKeys.rules()];

      return invalidate(queryClient, affected);
    }
  });
}

export function useSaveRule(rule?: Rule | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (details: Record<string, unknown>) => rule ? api(`rules/${encodeURIComponent(rule.id)}`, details, "PUT") : api("rules", details),
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

/** Deleting a rule keeps the categories it assigned, so only the rule list changes. */
export function useDeleteRule(rule: Rule) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api(`rules/${encodeURIComponent(rule.id)}`, undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, [queryKeys.rules()])
  });
}

const ruleOrderScope = "rule-order";

/**
 * Saves the matching order. The list shows the new order at once; orders are saved one after another, and a failed save restores the order shown before it.
 */
export function useReorderRules() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    scope: {
      id: ruleOrderScope
    },
    mutationFn: (rules: Rule[]) => api("rules/order", {
      ids: rules.map(rule => rule.id)
    }, "PUT"),
    onSettled: () => {
      // Later queued orders refresh the list themselves; refreshing in between would briefly show an older order.
      if (queryClient.isMutating({
        predicate: pending => pending.options.scope?.id === ruleOrderScope
      }) > 1) {
        return;
      }

      return invalidate(queryClient, [queryKeys.rules()]);
    }
  });

  async function save(rules: Rule[]) {
    const previous = queryClient.getQueryData<Rule[]>(queryKeys.rules());
    const ordered = withOrderedPriorities(rules);

    // Shown synchronously, so the dropped row stays where it was dropped; a cancelled refetch must not restore the old order.
    queryClient.setQueryData(queryKeys.rules(), ordered);
    await queryClient.cancelQueries({
      queryKey: queryKeys.rules()
    });
    queryClient.setQueryData(queryKeys.rules(), ordered);

    try {
      await mutation.mutateAsync(rules);
    } catch (error) {
      queryClient.setQueryData(queryKeys.rules(), previous);

      throw error;
    }
  }

  return {
    save,
    isPending: mutation.isPending
  };
}

export type DeletedCategory = {
  ok: true;
  transactions: number;
  rules: number;
};

/** Deleting a category moves its transactions and rules, which changes lists, rules and spending. */
export function useDeleteCategory(category: Category) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (replacementId: string | null) => api<DeletedCategory>(`categories/${encodeURIComponent(category.id)}`, {
      replacement_id: replacementId
    }, "DELETE"),
    onSettled: () => invalidate(queryClient, [queryKeys.categories(), queryKeys.rules(), queryKeys.transactions.all(), queryKeys.reports.cashFlow()])
  });
}
