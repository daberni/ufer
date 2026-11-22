"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { clsx } from "clsx";
import { authClient, requireAuthResult } from "@/features/auth/client";
import { ThemeChoice } from "@/features/appearance/components/theme-choice";
import { LocaleChoice } from "@/features/appearance/components/locale-choice";
import ui from "../../../components/ui/primitives.module.css";
import { FormError } from "@/components/ui/form-error";
import { toFailure, type Failure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import styles from "./account-settings.module.css";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";

type Props = {
  onClose: () => void;
};

export function AccountSettings({ onClose }: Props) {
  const locale = useLocale();
  const [mismatch, setMismatch] = useState(false);
  const { data } = authClient.useSession();

  // Each action reports its own outcome next to its button.
  const passwordChange = useMutation({
    mutationFn: async (passwords: {
      currentPassword: string;
      newPassword: string;
    }) => requireAuthResult(await authClient.changePassword(passwords))
  });

  const otherSessionsSignOut = useMutation({
    mutationFn: async () => requireAuthResult(await authClient.revokeOtherSessions())
  });

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const newPassword = String(fields.get("newPassword"));
    const confirmed = newPassword === fields.get("confirmation");

    setMismatch(!confirmed);

    if (!confirmed) {
      passwordChange.reset();

      return;
    }

    passwordChange.mutate({
      currentPassword: String(fields.get("currentPassword")),
      newPassword
    }, {
      onSuccess: () => form.reset()
    });
  }

  const passwordError = mismatch ? {
    message: "The new passwords do not match."
  } : failureOf(passwordChange.error, "The password could not be changed.");
  const sessionsError = failureOf(otherSessionsSignOut.error, "The sessions could not be signed out.");

  return (
    <Dialog title="Your account" closeLabel="Close account settings" onClose={onClose}>
      {/* The session loads when the dialog first opens; both lines keep their height so the dialog does not shift. */}
      <p className={styles["identity"]}>{data ? `${data.user.name} · ${data.user.username}` : ""}</p>
      <p className={styles["email"]}>{data?.user.email}</p>
      <ThemeChoice />
      <LocaleChoice />
      <form className={clsx(ui["form"], styles["section"])} onSubmit={changePassword}>
        <h3>Change password</h3>
        <label>
          Current password
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          New password
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          Confirm new password
          <input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <p className={ui["form-hint"]}>{`Use at least ${formatCount(12, locale)} characters. Changing your password signs out your other sessions.`}</p>
        <FormError failure={passwordError} />
        {passwordChange.isSuccess && <p className={ui["notice"]} role="status">Password changed. Your other sessions have been signed out.</p>}
        <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={passwordChange.isPending}>Change password</button>
      </form>
      <section className={styles["section"]} aria-labelledby="account-sessions-title">
        <h3 id="account-sessions-title">Other devices</h3>
        <p className={ui["form-hint"]}>Signs out every session except this one.</p>
        <FormError failure={sessionsError} />
        {otherSessionsSignOut.isSuccess && <p className={ui["notice"]} role="status">Your other sessions have been signed out.</p>}
        <button
          className={clsx(ui["button"], ui["full-width"], styles["section-action"])}
          type="button"
          onClick={() => otherSessionsSignOut.mutate()}
          disabled={otherSessionsSignOut.isPending}
        >Sign out other devices</button>
      </section>
    </Dialog>
  );
}

function failureOf(error: Error | null, fallback: string): Failure | null {
  if (!error) {
    return null;
  }

  return {
    ...toFailure(error),
    message: error.message || fallback
  };
}
