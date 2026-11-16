"use client";

import type { FormEvent } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { toFailure } from "@/client/api";

/**
 * Submits a dialog form through its mutation. The dialog closes once the write and the refresh of the affected data have finished, leaving the refreshed data as confirmation; failures stay inside the open dialog.
 */
export function useDialogSubmit<TData, TVariables>(mutation: UseMutationResult<TData, Error, TVariables>, close: () => void) {
  function submit(event: FormEvent<HTMLFormElement>, variables: (data: FormData) => TVariables, onClosed?: (value: TData) => void) {
    event.preventDefault();
    mutation.mutate(variables(new FormData(event.currentTarget)), {
      onSuccess: value => {
        close();
        onClosed?.(value);
      }
    });
  }

  return {
    error: mutation.error ? toFailure(mutation.error) : null,
    pending: mutation.isPending,
    submit
  };
}

export type DialogFormProps = {
  close: () => void;
};
