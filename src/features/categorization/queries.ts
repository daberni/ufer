"use client";

import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { apiGet, apiQuery } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { Category, CategoryUsage, Rule, RulePreview, RulePreviewDraft } from "@/features/categorization/types";

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories(),
    queryFn: ({ signal }) => apiGet<Category[]>("categories", undefined, signal)
  });
}

export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules(),
    queryFn: ({ signal }) => apiGet<Rule[]>("rules", undefined, signal)
  });
}

/** Counts what references a category, so deleting it can say what moves. */
export function useCategoryUsage(id: string) {
  return useQuery({
    queryKey: queryKeys.categoryUsage(id),
    queryFn: ({ signal }) => apiGet<CategoryUsage>(`categories/${encodeURIComponent(id)}/usage`, undefined, signal),
    staleTime: 0
  });
}

/**
 * Counts what a new or edited rule would categorize. Consumers must retire placeholder counts while an edited draft is being counted. The read posts the pattern, since
 * it comes from payee and remittance text that must not appear in URLs and request logs.
 */
export function useRulePreview(draft: RulePreviewDraft | null) {
  return useQuery({
    queryKey: queryKeys.rulePreview(draft),
    queryFn: draft ? ({ signal }) => apiQuery<RulePreview>("rules/preview", {
      pattern: draft.pattern,
      mode: draft.mode,
      priority: draft.priority,
      ...(draft.ruleId === null ? {} : {
        rule_id: draft.ruleId
      })
    }, signal) : skipToken,
    // Assignments change the count, so an open preview never reuses an earlier one.
    staleTime: 0,
    placeholderData: keepPreviousData
  });
}
