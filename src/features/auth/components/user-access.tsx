"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import { authClient, requireAuthResult } from "@/features/auth/client";
import { AccountSettings } from "./account-settings";
import ui from "@/components/ui/primitives.module.css";
import { failureMessage } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "lock" | "reportFeedback">;

export function UserAccess({
  lock,
  reportFeedback
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const signOut = useMutation({
    mutationFn: async () => requireAuthResult(await authClient.signOut()),
    onSuccess: lock,
    onError: error => reportFeedback({
      tone: "problem",
      messages: [`Sign-out failed: ${failureMessage(error)}`]
    })
  });

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
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        <LogOut size={18} />
      </button>
      {settingsOpen && <AccountSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
