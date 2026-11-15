"use client";

import { useState, type FormEvent } from "react";
import type { DashboardController } from "./use-dashboard";

// A dialog closes on success, leaving the refreshed data as confirmation, and keeps failures inside the open dialog.
export function useDialogSubmit(perform: DashboardController["perform"], close: () => void) {
  const [error, setError] = useState("");

  async function submit<T>(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<T>, onClosed?: (value: T) => void) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setError("");
    const result = await perform(() => action(data));

    if (!result.ok) {
      setError(result.message);

      return;
    }

    close();
    onClosed?.(result.value);
  }

  return {
    error,
    submit
  };
}

export type DialogSubmit = ReturnType<typeof useDialogSubmit>["submit"];

export type DialogFormProps = {
  error: string;
  submit: DialogSubmit;
};
