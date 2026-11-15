"use client";

import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { authClient, requireAuthResult } from "@/features/auth/client";
import { AccountSettings } from "./account-settings";
import ui from "@/components/ui/primitives.module.css";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "perform" | "reportFeedback" | "setLocked">;

export function UserAccess({
  perform,
  reportFeedback,
  setLocked
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function signOut() {
    const result = await perform(async () => {
      requireAuthResult(await authClient.signOut());
      setLocked(true);
    });

    if (!result.ok) {
      reportFeedback({
        tone: "problem",
        messages: [`Sign-out failed: ${result.message}`]
      });
    }
  }

  return (
    <>
      <button
        className={ui["icon-button"]}
        type="button"
        aria-label="Your account"
        onClick={() => setSettingsOpen(true)}
      >
        <UserRound size={18} />
      </button>
      <button
        className={ui["icon-button"]}
        type="button"
        aria-label="Sign out"
        onClick={signOut}
      >
        <LogOut size={18} />
      </button>
      {settingsOpen && <AccountSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
