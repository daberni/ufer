"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./login-form.module.css";
import { ArrowRight } from "lucide-react";
import { BrandIcon } from "@/components/branding/brand-icon";
import { ShorelineBackdrop } from "@/components/branding/illustrations";
import { api } from "@/client/api";
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
      <ShorelineBackdrop className={styles["shoreline"]} />
      <form
        className={clsx(styles["login-card"], ui["form"])}
        onSubmit={event => {
          event.preventDefault();
          const password = new FormData(event.currentTarget).get("password");

          perform(async () => {
            await api("auth/login", {
              password
            });
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
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
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
