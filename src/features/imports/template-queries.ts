"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiGet } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { CsvTemplate } from "./csv-templates";

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

/** Saves an editable copy of a template, such as a built-in one, under a new name. */
export function useDuplicateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      name
    }: {
      id: string;
      name: string;
    }) => api<{
      id: string;
    }>(`imports/templates/${encodeURIComponent(id)}/duplicate`, {
      name
    }),
    onSettled: () => invalidate(queryClient, [queryKeys.importTemplates()])
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api(`imports/templates/${encodeURIComponent(id)}`, undefined, "DELETE"),
    // Until the refetch succeeds, a cached deleted template would be offered and applied again.
    onSuccess: (_, id) => queryClient.setQueryData<CsvTemplate[]>(queryKeys.importTemplates(), current => current?.filter(template => template.id !== id)),
    onSettled: () => invalidate(queryClient, [queryKeys.importTemplates()])
  });
}
