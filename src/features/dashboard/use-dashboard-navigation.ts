"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Feedback } from "@/components/ui/use-action-feedback";
import { callbackFailureMessage, parseCallbackResult, type CallbackResult } from "@/features/banking/callback-result";
import { useAppStoreApi } from "@/client/app-store";
import { usePeriodScope, useView } from "@/client/use-app-url";
import { isPeriodAware } from "@/client/app-location";

/**
 * Keeps the UI store in step with navigation: a page message belongs to the view it was reported on, views without a period remember the last one selected, and a bank callback result is shown once.
 */
export function useDashboardNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const view = useView();
  const scope = usePeriodScope();
  const store = useAppStoreApi();

  useEffect(() => {
    store.getState().enterView(pathname);
  }, [store, pathname]);

  useEffect(() => {
    if (isPeriodAware(view)) {
      store.getState().rememberPeriodScope(scope);
    }
  }, [store, view, scope]);

  // The bank callback returns to the connections view with its result, which is shown once and removed from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = parseCallbackResult(params.get("banking"));

    if (!params.has("banking")) {
      return;
    }

    if (result) {
      store.getState().reportFeedback(bankingCallbackFeedback(result));
    }

    params.delete("banking");
    const rest = params.toString();

    router.replace(rest ? `${window.location.pathname}?${rest}` : window.location.pathname, {
      scroll: false
    });
  }, [store, router]);
}

function bankingCallbackFeedback(result: CallbackResult): Feedback {
  if (result === "connected") {
    return {
      tone: "success",
      messages: ["Bank connected. Select “Sync” to retrieve balances and transactions for the first time."]
    };
  }

  return {
    tone: "problem",
    messages: [callbackFailureMessage(result)]
  };
}
