"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./login-form.module.css";
import { ArrowRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { BrandIcon } from "@/components/branding/brand-icon";
import { ShorelineBackdrop } from "@/components/branding/illustrations";
import { apiGet, toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { LegalLinks } from "@/features/legal/components/legal-links";
import { SourceCodeNotice } from "@/features/legal/components/source-code-notice";
import { authClient, requireAuthResult } from "@/features/auth/client";
import { useAppStore } from "@/client/app-store";
import { signInMeta } from "@/client/use-session-lock";

type Credentials = {
  username: string;
  password: string;
};

export function LoginForm() {
  const unlock = useAppStore(state => state.unlock);
  const signIn = useMutation({
    meta: signInMeta,
    mutationFn: async (credentials: Credentials) => {
      requireAuthResult(await authClient.signIn.username(credentials));
      // Confirms that the new session has access to this workspace before the dashboard loads.
      await apiGet("me");
    },
    onSuccess: unlock
  });

  return (
    <main className={styles["login-page"]}>
      <ShorelineBackdrop className={styles["shoreline"]} />
      <form
        className={clsx(styles["login-card"], ui["form"])}
        onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);

          signIn.mutate({
            username: String(fields.get("username")),
            password: String(fields.get("password"))
          });
        }}
      >
        <div className={styles["brand-symbol"]}>
          <BrandIcon size={56} label="Ufer" />
        </div>
        <span className={ui["eyebrow"]}>YOUR PERSONAL OVERVIEW</span>
        <h1>Welcome back.</h1>
        <p>Your finances, under your control.</p>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <FormError failure={signIn.error ? toFailure(signIn.error) : null} />
        <button className={clsx(styles["button"], ui["primary"])} disabled={signIn.isPending}>
          Open dashboard <ArrowRight size={16} />
        </button>
        <div className={styles["legal"]}>
          <LegalLinks />
          <SourceCodeNotice />
        </div>
      </form>
    </main>
  );
}
