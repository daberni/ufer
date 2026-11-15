"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { Category, Rule } from "@/features/dashboard/types";

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
