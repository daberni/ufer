"use client";

import { useIsMutating, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { Category, Rule } from "@/features/categorization/types";
import { withOrderedPriorities } from "@/features/categorization/rule-order";

// Shared by saving an order and applying rules, so an apply always runs after the order shown in the list has been saved.
const ruleOrderScope = "rule-order";

export const ruleOrderKey = ["rules", "order"] as const;

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

/** Creates a rule from a manual assignment, which may hand the source transaction to the rule; applying it to uncategorized transactions also changes spending. */
export function useCreateRuleFromAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rule: Record<string, unknown>) => api<CreatedRule>("rules", rule),
    onSettled: (_result, _error, rule) => {
      // The source transaction can become rule-assigned; applying and adopting manual assignments also change categories and spending.
      const changesCategories = rule.apply_to_uncategorized === true || rule.adopt_manual === true;
      const affected = changesCategories ? [queryKeys.rules(), queryKeys.transactions.all(), queryKeys.reports.cashFlow()] : [queryKeys.rules(), queryKeys.transactions.all()];

      return invalidate(queryClient, affected);
    }
  });
}

export function useSaveRule(rule?: Rule | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (details: Record<string, unknown>) => rule ? api(`rules/${encodeURIComponent(rule.id)}`, details, "PUT") : api("rules", details),
    onSettled: (_result, _error, details) => {
      // Transaction rows show what returning to automatic categorization would assign; adopted manual assignments also change spending.
      const affected = details.adopt_manual === true ? [queryKeys.rules(), queryKeys.transactions.all(), queryKeys.reports.cashFlow()] : [queryKeys.rules(), queryKeys.transactions.lists()];

      return invalidate(queryClient, affected);
    }
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
    onSettled: () => invalidate(queryClient, [queryKeys.rules(), queryKeys.transactions.lists()])
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

/** Re-categorizes every transaction without a manual assignment, which changes lists and spending. It runs after any order save started before it. */
export function useApplyRules() {
  const queryClient = useQueryClient();

  return useMutation({
    scope: {
      id: ruleOrderScope
    },
    mutationFn: () => api("rules/apply", {}),
    onSettled: () => invalidate(queryClient, [queryKeys.transactions.all(), queryKeys.reports.cashFlow()])
  });
}

/** Deleting a rule keeps the categories it assigned but clears their reference to it, so transactions show the rule as no longer recorded. */
export function useDeleteRule(rule: Rule) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api(`rules/${encodeURIComponent(rule.id)}`, undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, [queryKeys.rules(), queryKeys.transactions.all()])
  });
}


/**
 * Saves the matching order. The list shows the new order at once; orders are saved one after another, and a failed save restores the order shown before it.
 */
export function useReorderRules() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ruleOrderKey,
    scope: {
      id: ruleOrderScope
    },
    mutationFn: (rules: Rule[]) => api("rules/order", {
      ids: rules.map(rule => rule.id)
    }, "PUT")
  });

  // Later queued orders restore and refresh the list themselves; doing it in between would briefly show an older order.
  function laterOrderPending() {
    return queryClient.isMutating({
      mutationKey: ruleOrderKey
    }) > 0;
  }

  async function save(rules: Rule[]) {
    const previous = queryClient.getQueryData<Rule[]>(queryKeys.rules());
    const ordered = withOrderedPriorities(rules);

    // Shown synchronously, so the dropped row stays where it was dropped; a cancelled refetch must not restore the old order.
    queryClient.setQueryData(queryKeys.rules(), ordered);
    // Queued at once, so an apply started from now on waits for this order.
    const saved = mutation.mutateAsync(rules);

    await queryClient.cancelQueries({
      queryKey: queryKeys.rules()
    });
    queryClient.setQueryData(queryKeys.rules(), ordered);

    try {
      await saved;
    } catch (error) {
      // The snapshot is restored before the refresh, so the stored list, including rules changed elsewhere, has the last word.
      if (!laterOrderPending()) {
        queryClient.setQueryData(queryKeys.rules(), previous);
        await invalidate(queryClient, [queryKeys.rules()]);
      }

      throw error;
    }

    if (!laterOrderPending()) {
      await invalidate(queryClient, [queryKeys.rules(), queryKeys.transactions.lists()]);
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

/** Whether a rule order is still being saved; applying rules waits for it. */
export function useSavingRuleOrder() {
  return useIsMutating({
    mutationKey: ruleOrderKey
  }) > 0;
}
