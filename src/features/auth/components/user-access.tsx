"use client";

import { useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { authClient, requireAuthResult } from "@/features/auth/client";
import { AccountSettings } from "./account-settings";
import ui from "@/components/ui/primitives.module.css";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "perform" | "setLocked">;

export function UserAccess({
  perform,
  setLocked
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        onClick={() => perform(async () => {
          requireAuthResult(await authClient.signOut());
          setLocked(true);
        })}
      >
        <LogOut size={18} />
      </button>
      {settingsOpen && <AccountSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
