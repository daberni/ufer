"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./page-heading.module.css";
import { RefreshCw } from "lucide-react";
import { api } from "@/client/api";
import { viewDescriptions } from "@/features/dashboard/presentation";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "bankAccounts" | "busy" | "nav" | "perform" | "setError" | "setNotice" | "view">;

export function PageHeading({
  bankAccounts,
  busy,
  nav,
  perform,
  setError,
  setNotice,
  view
}: Props) {
  return (
    <div className={styles["page-heading"]}>
      <div>
        <span className={ui["eyebrow"]}>CLARITY FOR YOUR FINANCES</span>
        <h1>{nav.label === "Overview" ? "Your money. In perspective." : nav.label}</h1>
        <p>{viewDescriptions[view]}</p>
      </div>
      <button
        className={clsx(styles["button"], ui["primary"])}
        disabled={busy || !bankAccounts.length}
        onClick={() => perform(async () => {
          const result = await api<{
            inserted: number;
            failures: string[];
          }>("sync", {});

          if (result.failures.length) {
            setError(result.failures.join(" · "));
          }

          setNotice(`${result.inserted} new transactions synced.`);
        })}
      >
        <RefreshCw size={15} className={busy ? ui["spinning"] : ""} />
        {busy ? "Processing …" : "Sync"}
      </button>
    </div>
  );
}
