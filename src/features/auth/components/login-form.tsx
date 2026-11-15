"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./login-form.module.css";
import { ArrowRight } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { api } from "@/client/api";
import { authClient, requireAuthResult } from "@/features/auth/client";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "error" | "perform" | "setLocked">;

export function LoginForm({
  busy,
  error,
  perform,
  setLocked
}: Props) {
  return (
    <main className={styles["login-page"]}>
      <form
        className={clsx(styles["login-card"], ui["form"])}
        onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const username = String(fields.get("username"));
          const password = String(fields.get("password"));

          perform(async () => {
            requireAuthResult(await authClient.signIn.username({
              username,
              password
            }));
            await api("me");
            setLocked(false);
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
        {error && (
          <p role="alert" className={ui["error-text"]}>
            {error}
          </p>
        )}
        <button className={clsx(styles["button"], ui["primary"])} disabled={busy}>
          Open dashboard <ArrowRight size={16} />
        </button>
      </form>
    </main>
  );
}
