"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import type { Feedback } from "@/components/ui/use-action-feedback";
import { parseCallbackResult, type CallbackResult } from "@/features/banking/callback-result";
import { useAppStoreApi } from "@/client/app-store";
import { useArchivedAccountsOpen, usePeriodScope, useView } from "@/client/use-app-url";
import { isAccountList, isPeriodAware } from "@/client/app-location";

/**
 * Keeps the UI store in step with navigation: a page message belongs to the view it was reported on, views without a period remember the last one selected, an account's details return to the list they were opened from, and a bank callback result is shown once.
 */
export function useDashboardNavigation() {
  const t = useTranslations("overview");
  const tCallback = useTranslations("banking.callback");
  const router = useRouter();
  const pathname = usePathname();
  const view = useView();
  const scope = usePeriodScope();
  const store = useAppStoreApi();
  const archivedOpen = useArchivedAccountsOpen();

  useEffect(() => {
    store.getState().enterView(pathname);
  }, [store, pathname]);

  useEffect(() => {
    if (isPeriodAware(view)) {
      store.getState().rememberPeriodScope(scope);
    }
  }, [store, view, scope]);

  useEffect(() => {
    if (isAccountList(view)) {
      store.getState().rememberAccountList(view);
    }
  }, [store, view]);

  useEffect(() => {
    if (view === "accounts") {
      store.getState().rememberArchivedAccountsOpen(archivedOpen);
    }
  }, [store, view, archivedOpen]);

  // The bank callback returns to the accounts connections section with its result, which is shown once and removed from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = parseCallbackResult(params.get("banking"));

    if (!params.has("banking")) {
      return;
    }

    if (result) {
      store.getState().reportFeedback(bankingCallbackFeedback(result, result === "connected" ? t("bankConnected") : tCallback(result)));
    }

    params.delete("banking");
    const rest = params.toString();

    const destination = rest ? `${window.location.pathname}?${rest}` : window.location.pathname;

    router.replace(`${destination}${window.location.hash}`, {
      scroll: false
    });
  }, [store, router, t, tCallback]);
}

function bankingCallbackFeedback(result: CallbackResult, message: string): Feedback {
  if (result === "connected") {
    return {
      tone: "success",
      messages: [message]
    };
  }

  return {
    tone: "problem",
    messages: [message]
  };
}
