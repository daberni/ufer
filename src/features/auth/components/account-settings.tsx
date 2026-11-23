"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { clsx } from "clsx";
import { authClient, requireAuthResult } from "@/features/auth/client";
import { ThemeChoice } from "@/features/appearance/components/theme-choice";
import { LocaleChoice } from "@/features/appearance/components/locale-choice";
import { LanguageChoice } from "@/features/appearance/components/language-choice";
import ui from "../../../components/ui/primitives.module.css";
import { FormError } from "@/components/ui/form-error";
import { toFailure, type Failure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import styles from "./account-settings.module.css";
import { useTranslations } from "next-intl";

type Props = {
  onClose: () => void;
};

export function AccountSettings({ onClose }: Props) {
  const t = useTranslations("account.settings");
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
    message: t("passwordMismatch")
  } : failureOf(passwordChange.error, t("passwordFailed"));
  const sessionsError = failureOf(otherSessionsSignOut.error, t("signOutOthersFailed"));

  return (
    <Dialog title={t("title")} closeLabel={t("close")} onClose={onClose}>
      {/* The session loads when the dialog first opens; both lines keep their height so the dialog does not shift. */}
      <p className={styles["identity"]}>{data ? `${data.user.name} · ${data.user.username}` : ""}</p>
      <p className={styles["email"]}>{data?.user.email}</p>
      <ThemeChoice />
      <LanguageChoice />
      <LocaleChoice />
      <form className={clsx(ui["form"], styles["section"])} onSubmit={changePassword}>
        <h3>{t("changePassword")}</h3>
        <label>
          {t("currentPassword")}
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          {t("newPassword")}
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
          {t("confirmPassword")}
          <input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <p className={ui["form-hint"]}>{t("passwordHint", {
          count: 12
        })}</p>
        <FormError failure={passwordError} />
        {passwordChange.isSuccess && <p className={ui["notice"]} role="status">{t("passwordChanged")}</p>}
        <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={passwordChange.isPending}>{t("changePassword")}</button>
      </form>
      <section className={styles["section"]} aria-labelledby="account-sessions-title">
        <h3 id="account-sessions-title">{t("otherDevices")}</h3>
        <p className={ui["form-hint"]}>{t("otherDevicesHint")}</p>
        <FormError failure={sessionsError} />
        {otherSessionsSignOut.isSuccess && <p className={ui["notice"]} role="status">{t("othersSignedOut")}</p>}
        <button
          className={clsx(ui["button"], ui["full-width"], styles["section-action"])}
          type="button"
          onClick={() => otherSessionsSignOut.mutate()}
          disabled={otherSessionsSignOut.isPending}
        >{t("signOutOthers")}</button>
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
