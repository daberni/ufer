"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { authClient, requireAuthResult } from "@/features/auth/client";
import ui from "@/components/ui/primitives.module.css";
import styles from "./account-settings.module.css";

type Props = {
  onClose: () => void;
};

export function AccountSettings({ onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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

  // Each action has its own pending state; the message area shows the outcome of the latest one.
  const passwordChange = useMutation({
    mutationFn: async (passwords: {
      currentPassword: string;
      newPassword: string;
    }) => requireAuthResult(await authClient.changePassword({
      ...passwords,
      revokeOtherSessions: true
    })),
    onSuccess: () => setNotice("Password changed. Your other sessions have been signed out."),
    onError: failure => setError(failure.message || "The password could not be changed.")
  });

  const otherSessionsSignOut = useMutation({
    mutationFn: async () => requireAuthResult(await authClient.revokeOtherSessions()),
    onSuccess: () => setNotice("Your other sessions have been signed out."),
    onError: failure => setError(failure.message || "The sessions could not be signed out.")
  });

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const newPassword = String(fields.get("newPassword"));

    setError("");
    setNotice("");

    if (newPassword !== fields.get("confirmation")) {
      setError("The new passwords do not match.");

      return;
    }

    passwordChange.mutate({
      currentPassword: String(fields.get("currentPassword")),
      newPassword
    }, {
      onSuccess: () => form.reset()
    });
  }

  function signOutOthers() {
    setError("");
    setNotice("");
    otherSessionsSignOut.mutate();
  }

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
      <p className={styles.identity}>{data?.user.name} · {data?.user.username}</p>
      <p className={styles.email}>{data?.user.email}</p>
      <form className={ui.form} onSubmit={changePassword}>
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
        {error && <p className={ui["error-text"]} role="alert">{error}</p>}
        {notice && <p className={ui.notice} role="status">{notice}</p>}
        <button className={clsx(ui.button, ui.primary)} disabled={passwordChange.isPending}>Change password</button>
        <button
          className={clsx(ui.button, ui.secondary)}
          type="button"
          onClick={signOutOthers}
          disabled={otherSessionsSignOut.isPending}
        >Sign out other devices</button>
      </form>
    </dialog>
  );
}
