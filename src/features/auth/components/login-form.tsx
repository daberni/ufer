"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./login-form.module.css";
import { ArrowRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { BrandIcon } from "@/components/branding/brand-icon";
import { ShorelineBackdrop } from "@/components/branding/illustrations";
import { apiGet, failureMessage } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { authClient, requireAuthResult } from "@/features/auth/client";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "unlock">;

type Credentials = {
  username: string;
  password: string;
};

export function LoginForm({ unlock }: Props) {
  const signIn = useMutation({
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
        <FormError message={signIn.error ? failureMessage(signIn.error) : ""} />
        <button className={clsx(styles["button"], ui["primary"])} disabled={signIn.isPending}>
          Open dashboard <ArrowRight size={16} />
        </button>
      </form>
    </main>
  );
}
