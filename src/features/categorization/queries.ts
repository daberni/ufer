"use client";

import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { Category, Rule, RulePreview, RulePreviewDraft } from "@/features/categorization/types";

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

/** Counts what a keyword rule would categorize; the previous count stays shown while an edited pattern is counted. */
export function useRulePreview(draft: RulePreviewDraft | null) {
  return useQuery({
    queryKey: queryKeys.rulePreview(draft),
    queryFn: draft ? ({ signal }) => apiGet<RulePreview>("rules/preview", {
      pattern: draft.pattern,
      mode: "keyword",
      priority: String(draft.priority)
    }, signal) : skipToken,
    // Assignments change the count, so an open preview never reuses an earlier one.
    staleTime: 0,
    placeholderData: keepPreviousData
  });
}
