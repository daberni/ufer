"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { authClient, requireAuthResult } from "@/features/auth/client";
import { ThemeChoice } from "@/features/appearance/components/theme-choice";
import ui from "@/components/ui/primitives.module.css";
import styles from "./account-settings.module.css";

type Props = {
  onClose: () => void;
};

export function AccountSettings({ onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mismatch, setMismatch] = useState(false);
  const { data } = authClient.useSession();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;

    dialog?.showModal();

    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);

  // Each action reports its own outcome next to its button.
  const passwordChange = useMutation({
    mutationFn: async (passwords: {
      currentPassword: string;
      newPassword: string;
    }) => requireAuthResult(await authClient.changePassword({
      ...passwords,
      revokeOtherSessions: true
    }))
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

  const passwordError = mismatch ? "The new passwords do not match." : failureText(passwordChange.error, "The password could not be changed.");
  const sessionsError = failureText(otherSessionsSignOut.error, "The sessions could not be signed out.");

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="account-settings-title"
      onCancel={onClose}
    >
      <div className={styles.heading}>
        <h2 id="account-settings-title">Your account</h2>
        <button
          className={ui["icon-button"]}
          type="button"
          onClick={onClose}
          aria-label="Close account settings"
        >
          <X size={20} />
        </button>
      </div>
      {/* The session loads when the dialog first opens; both lines keep their height so the dialog does not shift. */}
      <p className={styles.identity}>{data ? `${data.user.name} · ${data.user.username}` : ""}</p>
      <p className={styles.email}>{data?.user.email}</p>
      <ThemeChoice />
      <form className={clsx(ui.form, styles.section)} onSubmit={changePassword}>
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
        <p className={ui["form-hint"]}>Use at least 12 characters. Changing your password signs out your other sessions.</p>
        {passwordError && <p className={ui["error-text"]} role="alert">{passwordError}</p>}
        {passwordChange.isSuccess && <p className={ui.notice} role="status">Password changed. Your other sessions have been signed out.</p>}
        <button className={clsx(ui.button, ui.primary, ui["full-width"])} disabled={passwordChange.isPending}>Change password</button>
      </form>
      <section className={styles.section} aria-labelledby="account-sessions-title">
        <h3 id="account-sessions-title">Other devices</h3>
        <p className={ui["form-hint"]}>Signs out every session except this one.</p>
        {sessionsError && <p className={ui["error-text"]} role="alert">{sessionsError}</p>}
        {otherSessionsSignOut.isSuccess && <p className={ui.notice} role="status">Your other sessions have been signed out.</p>}
        <button
          className={clsx(ui.button, ui["full-width"], styles["section-action"])}
          type="button"
          onClick={() => otherSessionsSignOut.mutate()}
          disabled={otherSessionsSignOut.isPending}
        >Sign out other devices</button>
      </section>
    </dialog>
  );
}

function failureText(error: Error | null, fallback: string) {
  if (!error) {
    return "";
  }

  return error.message || fallback;
}
