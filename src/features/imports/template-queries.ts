"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiGet } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { CsvTemplate } from "./csv-mapping";

export type TemplateInput = Omit<CsvTemplate, "id" | "builtIn">;

export function useImportTemplates() {
  return useQuery({
    queryKey: queryKeys.importTemplates(),
    queryFn: ({ signal }) => apiGet<CsvTemplate[]>("imports/templates", undefined, signal)
  });
}

export function useSaveTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (template: TemplateInput) => api<{
      id: string;
    }>("imports/templates", template),
    onSettled: () => invalidate(queryClient, [queryKeys.importTemplates()])
  });
}

/** Renames a template (`name`) or replaces its mapping (`definition`). */
export function useChangeTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...change
    }: {
      id: string;
      name?: string;
      definition?: Omit<TemplateInput, "name">;
    }) => api(`imports/templates/${encodeURIComponent(id)}`, change, "PATCH"),
    onSettled: () => invalidate(queryClient, [queryKeys.importTemplates()])
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api(`imports/templates/${encodeURIComponent(id)}`, undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, [queryKeys.importTemplates()])
  });
}
